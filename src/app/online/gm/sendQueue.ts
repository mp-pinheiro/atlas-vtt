import { MAX_BATCH_SENDS, MAX_GM_FRAME, PROTOCOL_VERSION } from '../protocol/index.ts';
import { companionTimers, type Timers } from './companionTimers.ts';
import { utf8Length } from '../protocol/shape.ts';

/** What the queue needs of a socket. */
export interface QueueSocket {
  readonly bufferedAmount: number;
  send(text: string): void;
}

/** Frames a second the queue sends at most over time, below the relay's GM rate limit (100). */
export const FRAMES_PER_SECOND = 80;
/** Frames the queue may send at once after a quiet spell, well below the relay's burst (200). */
export const BURST = 40;
/** Bytes the socket may hold unsent before even a live frame waits. */
export const MAX_BUFFERED = 1024 * 1024;
/**
 * Bytes the socket may hold unsent before other frames wait: about one asset chunk, so a live frame
 * never queues behind more than that on a slow uplink.
 */
export const BULK_BUFFERED = 64 * 1024;
/**
 * While the relay takes `sends` frames, the queue sends one at most this often while game messages
 * keep coming: everything that came meanwhile goes in it. One after a quiet spell goes at once, and a
 * frame that is full makes room for the next at once.
 */
export const BATCH_MS = 50;
/** How soon the queue looks again while the socket drains. */
const DRAIN_CHECK_MS = 10;
/** A `sends` frame without its entries, whose length every batch counts. */
const BATCH_HEAD = `{"v":${PROTOCOL_VERSION},"t":"sends","sends":[`;
const BATCH_TAIL = ']}';

/** The clock and timers the queue paces with; the companion's in Obsidian, fakes in tests. */
export type QueueClock = Timers;

export interface DeliveryValidity {
  readonly recipient?: string;
  readonly scene?: string;
  readonly generation?: number;
  readonly projection?: number;
  valid(): boolean;
}

export interface PacketIdentity {
  readonly recipient: string;
  readonly scene: string;
  readonly revision: number;
}

export interface QueueFrame {
  readonly text: string;
  readonly to: string | undefined;
  readonly entry: string | undefined;
  readonly entryBytes: number;
}

interface QueuedFrame extends QueueFrame {
  readonly validity?: DeliveryValidity;
}

interface QueuedPacket {
  readonly frames: readonly QueueFrame[];
  readonly to: string | undefined;
  readonly validity?: DeliveryValidity;
  readonly identity?: PacketIdentity;
  index: number;
}

type Queued = QueuedFrame | QueuedPacket;
type Next = { readonly frame: QueueFrame; readonly live: true; readonly key: string } | { readonly frame: QueueFrame; readonly live: false };
const pending = (item: Queued): number => 'frames' in item ? item.frames.length - item.index : 1;

export class SendQueue {
  private frames: Queued[] = [];
  private readonly live = new Map<string, QueuedFrame>();
  private queued = 0;
  private socket: QueueSocket | null = null;
  private batching = false;
  private timer: number | undefined;
  private tokens = BURST;
  private filledAt: number;
  private sentAt = Number.NEGATIVE_INFINITY;
  private full = false;
  private readonly clock: QueueClock;

  constructor(clock: QueueClock = companionTimers()) {
    this.clock = clock;
    this.filledAt = clock.now();
  }

  get length(): number {
    return this.queued + this.live.size;
  }

  push(frame: string, to?: string, entry?: string, validity?: DeliveryValidity): void {
    this.frames.push({ text: frame, to, entry, entryBytes: entry === undefined ? 0 : utf8Length(entry), ...(validity === undefined ? {} : { validity }) });
    this.queued += 1;
    this.pump();
  }

  pushPacket(frames: readonly QueueFrame[], validity?: DeliveryValidity, identity?: PacketIdentity): void {
    const first = frames[0];
    if (first === undefined || validity?.valid() === false) return;
    this.frames.push({ frames, to: first.to, index: 0, ...(validity === undefined ? {} : { validity }), ...(identity === undefined ? {} : { identity }) });
    this.queued += frames.length;
    this.pump();
  }

  pushLive(key: string, frame: string, to?: string, entry?: string, validity?: DeliveryValidity): void {
    this.live.delete(key);
    this.live.set(key, { text: frame, to, entry, entryBytes: entry === undefined ? 0 : utf8Length(entry), ...(validity === undefined ? {} : { validity }) });
    this.pump();
  }

  drop(gone: (to: string) => boolean): void {
    this.frames = this.frames.filter(item => {
      if (item.to === undefined || !gone(item.to)) return true;
      this.queued -= pending(item);
      return false;
    });
    for (const [key, frame] of this.live) if (frame.to !== undefined && gone(frame.to)) this.live.delete(key);
  }

  attach(socket: QueueSocket, batching = false): void {
    this.socket = socket;
    this.batching = batching;
    this.pump();
  }

  detach(): void {
    this.socket = null;
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  pump(): void {
    if (this.socket === null || this.timer !== undefined) return;
    for (;;) {
      const next = this.next();
      if (next === null) return;
      const gap = this.sentAt + BATCH_MS - this.clock.now();
      if (this.batching && !this.full && gap > 0) return this.wait(gap);
      this.refill();
      if (this.tokens < 1) return this.wait(((1 - this.tokens) * 1000) / FRAMES_PER_SECOND);
      if (this.socket.bufferedAmount > (next.live ? MAX_BUFFERED : BULK_BUFFERED)) return this.wait(DRAIN_CHECK_MS);
      const text = this.batching ? this.takeBatch(this.socket.bufferedAmount) : this.take(next).text;
      if (text === null) continue;
      this.tokens -= 1;
      this.sentAt = this.clock.now();
      this.socket.send(text);
    }
  }

  private next(): Next | null {
    let item = this.frames[0];
    while (item !== undefined && item.validity?.valid() === false) {
      this.queued -= pending(item);
      this.frames.shift();
      item = this.frames[0];
    }
    if (item !== undefined && 'frames' in item && item.index > 0) {
      const frame = item.frames[item.index];
      if (frame !== undefined) return { frame, live: false };
    }
    for (const [key, frame] of this.live) {
      if (frame.validity?.valid() === false) this.live.delete(key);
      else return { frame, key, live: true };
    }
    if (item === undefined) return null;
    const frame = 'frames' in item ? item.frames[item.index] : item;
    return frame === undefined ? null : { frame, live: false };
  }

  private take(next: Next): QueueFrame {
    if (next.live) this.live.delete(next.key);
    else {
      const item = this.frames[0];
      if (item !== undefined && 'frames' in item) {
        item.index += 1;
        if (item.index === item.frames.length) this.frames.shift();
      } else this.frames.shift();
      this.queued -= 1;
    }
    return next.frame;
  }

  private takeBatch(buffered: number): string | null {
    const taken: QueueFrame[] = [];
    let size = BATCH_HEAD.length + BATCH_TAIL.length;
    this.full = false;
    for (let next = this.next(); next !== null; next = this.next()) {
      if (!next.live && buffered > BULK_BUFFERED) break;
      const { entry, entryBytes } = next.frame;
      const fits = entry !== undefined && taken.length < MAX_BATCH_SENDS && size + entryBytes + 1 <= MAX_GM_FRAME;
      if (!fits) {
        if (taken.length === 0) return this.take(next).text;
        this.full = true;
        break;
      }
      taken.push(this.take(next));
      size += entryBytes + 1;
    }
    const first = taken[0];
    if (first === undefined) return null;
    if (taken.length === 1) return first.text;
    return `${BATCH_HEAD}${taken.map(frame => frame.entry).join(',')}${BATCH_TAIL}`;
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(BURST, this.tokens + ((now - this.filledAt) * FRAMES_PER_SECOND) / 1000);
    this.filledAt = now;
  }

  private wait(ms: number): void {
    this.timer = this.clock.setTimer(() => {
      this.timer = undefined;
      this.pump();
    }, Math.max(1, Math.ceil(ms)));
  }
}
