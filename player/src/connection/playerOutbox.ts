import { MAX_PLAYER_FRAME } from '../../../src/app/online/protocol/relay.ts';
import { parsePlayerMessage, type PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { ConnectionTimers } from '../state/interfaces.ts';

interface Bucket { tokens: number; updated: number; readonly capacity: number; readonly perSecond: number }
const replaceable = (message: PlayerMessage): boolean => message.t === 'drag' || message.t === 'cursor' || message.t === 'laser' || (message.t === 'measure' && message.live !== null);
const isDiscrete = (message: PlayerMessage): boolean => !replaceable(message);

export interface PlayerOutboxOptions {
  readonly send: (message: PlayerMessage) => boolean;
  readonly online: () => boolean;
  readonly ready?: () => boolean;
  readonly timers?: ConnectionTimers;
  readonly onBusy?: (busy: boolean) => void;
  readonly onRefused?: (message: PlayerMessage) => void;
}

export class PlayerOutbox {
  private readonly buckets = new Map<string, Bucket>();
  private readonly queue: PlayerMessage[] = [];
  private readonly activeAssets = new Set<string>();
  private readonly resync = new Set<string>();
  private readonly bookPending = new Map<string, PlayerMessage>();
  private readonly deferredMovement = new Set<string>();
  private readonly timers: ConnectionTimers;
  private global: Bucket;
  private flushTimer: unknown = null;
  private bookTimer: unknown = null;
  private serial = 0;

  constructor(private readonly options: PlayerOutboxOptions) {
    this.timers = options.timers ?? {
      setTimeout(callback, delay) { return globalThis.setTimeout(callback, delay); },
      clearTimeout(handle) { globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>); },
      setInterval(callback, delay) { return globalThis.setInterval(callback, delay); },
      clearInterval(handle) { globalThis.clearInterval(handle as ReturnType<typeof setInterval>); },
      now() { return Date.now(); },
      random() { return Math.random(); },
    };
    this.global = { tokens: 140, updated: this.timers.now(), capacity: 140, perSecond: 140 };
  }

  send(input: PlayerMessage): boolean {
    const message = parsePlayerMessage(input);
    if (!message || !this.options.online()) return false;
    if (new TextEncoder().encode(JSON.stringify({ v: 1, t: 'send', body: message })).byteLength > MAX_PLAYER_FRAME) return this.refuse(message);
    if (message.t === 'path-cancel' && this.queue.some(queued => queued.t === 'path-cancel' && queued.scene === message.scene && queued.id === message.id && queued.request === message.request)) return true;
    if (message.t === 'asset-request' && this.activeAssets.size >= 4 && !this.activeAssets.has(`${message.hash}|${message.maxSide ?? 0}`)) return this.refuse(message);
    if (message.t === 'resync' || message.t === 'picture-resync') {
      const key = `${message.scene}:${message.t === 'resync' ? message.of : 'picture'}`;
      if (this.resync.has(key)) return false;
    }
    if (message.t.startsWith('book-') && message.t !== 'book-parts') return this.enqueueBook(message);
    const group = this.bucketGroup(message);
    const charged = group === null || this.take(group);
    if (!charged && message.t !== 'path-cancel') return this.refuse(message);
    if (replaceable(message)) {
      const key = this.coalesceKey(message);
      const index = this.queue.findIndex((queued) => replaceable(queued) && this.bucketGroup(queued) === group && this.coalesceKey(queued) === key && (message.t !== 'measure' || queued.t === 'measure' && JSON.stringify(queued.kept) === JSON.stringify(message.kept)));
      if (index >= 0) this.queue[index] = message;
      else this.queue.push(message);
    } else {
      if (this.discreteCount() >= 128) return this.refuse(message);
      this.queue.push(message);
    }
    if (message.t === 'path-cancel' && !charged) this.deferredMovement.add(this.pathCancelKey(message));
    if (message.t === 'asset-request') this.activeAssets.add(`${message.hash}|${message.maxSide ?? 0}`);
    if (message.t === 'resync' || message.t === 'picture-resync') {
      const channel = message.t === 'resync' ? message.of : 'picture';
      this.resync.add(`${message.scene}:${channel}`);
    }
    this.flush();
    return true;
  }

  assetFinished(hash: string, maxSide?: number): void { this.activeAssets.delete(`${hash}|${maxSide ?? 0}`); }
  resyncFinished(scene: string, channel: string): void { this.resync.delete(`${scene}:${channel}`); }
  sceneChanged(scene: string | null): void {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const message = this.queue[index];
      if (message === undefined) continue;
      if ('scene' in message && message.scene !== scene || message.t === 'sheet-roll') {
        this.queue.splice(index, 1);
        if (message.t === 'path-cancel') this.deferredMovement.delete(this.pathCancelKey(message));
        this.options.onRefused?.(message);
      }
    }
    for (const key of this.resync) if (!key.startsWith(`${scene}:`)) this.resync.delete(key);
    this.options.onBusy?.(this.discreteCount() >= 128);
  }
  clear(): void {
    this.queue.length = 0;
    this.bookPending.clear();
    this.activeAssets.clear();
    this.resync.clear();
    this.deferredMovement.clear();
    if (this.bookTimer !== null) this.timers.clearTimeout(this.bookTimer);
    if (this.flushTimer !== null) this.timers.clearTimeout(this.flushTimer);
    this.bookTimer = null;
    this.flushTimer = null;
    this.options.onBusy?.(false);
  }
  characterChanged(): void {
    for (const [key, message] of this.bookPending) {
      if (message.t === 'book-resource') {
        this.bookPending.delete(key);
        this.options.onRefused?.(message);
      }
    }
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const message = this.queue[index];
      if (message === undefined) continue;
      if (message.t === 'book-resource' || message.t === 'sheet-roll') {
        this.queue.splice(index, 1);
        this.options.onRefused?.(message);
      }
    }
    this.options.onBusy?.(this.discreteCount() >= 128);
  }

  private enqueueBook(message: PlayerMessage): boolean {
    const key = this.bookKey(message) ?? `discrete:${this.serial++}`;
    if (!this.bookPending.has(key) && this.discreteCount() >= 128) return this.refuse(message);
    this.bookPending.set(key, message);
    this.scheduleBook();
    return true;
  }

  private scheduleBook(): void {
    if (this.bookTimer !== null || this.bookPending.size === 0) return;
    this.bookTimer = this.timers.setTimeout(() => {
      this.bookTimer = null;
      if (!this.options.online()) { this.clear(); return; }
      const first = this.bookPending.entries().next().value;
      if (first !== undefined) {
        this.bookPending.delete(first[0]);
        this.queue.push(first[1]);
        this.flush();
      }
      this.scheduleBook();
    }, 100);
  }

  private flush(): void {
    if (!this.options.online()) { this.clear(); return; }
    for (let next = this.queue[0]; next !== undefined; next = this.queue[0]) {
      if (this.options.ready && !this.options.ready()) {
        this.options.onBusy?.(true);
        this.scheduleFlush();
        return;
      }
      const frame = JSON.stringify({ v: 1, t: 'send', body: next });
      if (new TextEncoder().encode(frame).byteLength > MAX_PLAYER_FRAME) {
        this.queue.shift();
        if (next.t === 'path-cancel') this.deferredMovement.delete(this.pathCancelKey(next));
        this.options.onRefused?.(next);
        continue;
      }
      if (next.t === 'path-cancel' && this.deferredMovement.has(this.pathCancelKey(next))) {
        if (!this.take('movement')) {
          this.options.onBusy?.(true);
          this.scheduleFlush(this.bucketDelay('movement'));
          return;
        }
        this.deferredMovement.delete(this.pathCancelKey(next));
      }
      if (!this.takeGlobal()) {
        this.options.onBusy?.(true);
        this.scheduleFlush();
        return;
      }
      if (!this.options.send(next)) {
        this.clear();
        this.options.onRefused?.(next);
        return;
      }
      this.queue.shift();
    }
    this.options.onBusy?.(false);
  }

  private take(group: string): boolean {
    const now = this.timers.now();
    const existing = this.buckets.get(group);
    const [capacity, perSecond] = this.bucketRule(group);
    const bucket = existing ?? { tokens: capacity, updated: now, capacity, perSecond };
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.max(0, now - bucket.updated) * bucket.perSecond / 1000);
    bucket.updated = now;
    if (bucket.tokens < 1) { this.buckets.set(group, bucket); return false; }
    bucket.tokens--;
    this.buckets.set(group, bucket);
    return true;
  }
  private bucketDelay(group: string): number {
    const now = this.timers.now();
    const existing = this.buckets.get(group);
    const [capacity, perSecond] = this.bucketRule(group);
    const bucket = existing ?? { tokens: capacity, updated: now, capacity, perSecond };
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.max(0, now - bucket.updated) * bucket.perSecond / 1000);
    bucket.updated = now;
    this.buckets.set(group, bucket);
    return bucket.tokens >= 1 ? 1 : Math.max(1, Math.ceil((1 - bucket.tokens) * 1000 / bucket.perSecond));
  }

  private bucketRule(group: string): readonly [number, number] {
    return group === 'movement' ? [8, 6] : group === 'action' ? [3, 1] : group === 'chat' ? [5, 0.5] : [40, 40];
  }

  private takeGlobal(): boolean {
    const now = this.timers.now();
    this.global.tokens = Math.min(this.global.capacity, this.global.tokens + Math.max(0, now - this.global.updated) * this.global.perSecond / 1000);
    this.global.updated = now;
    if (this.global.tokens < 1) return false;
    this.global.tokens--;
    return true;
  }

  private scheduleFlush(delay = 10): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, delay);
  }

  private bucketGroup(message: PlayerMessage): string | null {
    switch (message.t) {
      case 'move': case 'path': case 'path-cancel': case 'door': case 'condition': return 'movement';
      case 'drag': case 'drag-cancel': return 'drag';
      case 'roll': case 'sheet-roll': case 'initiative-roll': case 'end-turn': case 'colour': return 'action';
      case 'cursor': case 'laser': case 'measure': return message.t;
      case 'chat': case 'chat-edit': case 'chat-delete': case 'react': return 'chat';
      default: return null;
    }
  }
  private pathCancelKey(message: Extract<PlayerMessage, { t: 'path-cancel' }>): string {
    return `${message.scene}|${message.id}|${message.request}`;
  }

  private coalesceKey(message: PlayerMessage): string {
    if (message.t === 'drag') return message.id;
    return message.t;
  }

  private bookKey(message: PlayerMessage): string | null {
    if (message.t === 'book-resource') return `resource:${message.key}`;
    if (message.t === 'book-purse') return 'purse';
    if (message.t === 'book-slots') return 'slots';
    if (message.t === 'book-equip') return `equip:${message.item}`;
    return null;
  }

  private discreteCount(): number {
    return this.queue.reduce((count, message) => count + Number(isDiscrete(message)), this.bookPending.size);
  }

  private refuse(message: PlayerMessage): false {
    this.options.onBusy?.(this.discreteCount() >= 128);
    this.options.onRefused?.(message);
    return false;
  }
}
