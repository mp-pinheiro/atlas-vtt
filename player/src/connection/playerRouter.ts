import { DeltaReader } from '../../../src/app/online/protocol/deltaReader.ts';
import { MAX_PARTS, parseGmMessage, type GmMessage, type PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import type { PictureChannel, PictureMessage } from '../../../src/app/online/protocol/picture.ts';
import type { DeltaOf } from '../../../src/app/online/protocol/delta.ts';
import type { AgencyResponse } from '../../../src/app/online/protocol/agency.ts';
import type { PlayerState } from '../state/playerStore.ts';
import type { StoreApi } from 'zustand/vanilla';
import { ASSET_CHUNK_BYTES } from '../../../src/app/online/protocol/asset.ts';

const PART_BYTES = ASSET_CHUNK_BYTES;
const PART_LIMIT = MAX_PARTS * PART_BYTES;
const PART_TTL = 30_000;
interface Assembly { readonly count: number; readonly generation: number; readonly created: number; readonly bytes: (Uint8Array | undefined)[]; size: number; timer: unknown }

export interface PlayerRouterOptions {
  readonly store: StoreApi<PlayerState>;
  readonly send: (message: PlayerMessage) => boolean;
  readonly onMessage?: (message: GmMessage) => void;
  readonly now?: () => number;
  readonly timers?: { setTimeout(callback: () => void, delay: number): unknown; clearTimeout(handle: unknown): void };
  readonly onResyncComplete?: (scene: string, channel: string) => void;
}

export class PlayerRouter {
  private deltas = new DeltaReader();
  private readonly assemblies = new Map<string, Assembly>();
  private readonly invalid = new Set<DeltaOf>();
  private readonly channelResync = new Set<DeltaOf>();
  private readonly now: () => number;
  private totalPartBytes = 0;
  private pictureResyncPending = false;
  private readonly unsubscribe: () => void;
  private readonly timers: { setTimeout(callback: () => void, delay: number): unknown; clearTimeout(handle: unknown): void };

  constructor(private readonly options: PlayerRouterOptions) {
    this.timers = options.timers ?? {
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
    };
    this.now = options.now ?? Date.now;
    this.unsubscribe = options.store.subscribe((state, previous) => {
      if (state.generation === previous.generation && state.transportGeneration === previous.transportGeneration) return;
      if (state.transportGeneration !== previous.transportGeneration) this.resetAssemblies();
      this.deltas = new DeltaReader();
      this.invalid.clear();
      this.channelResync.clear();
      this.pictureResyncPending = false;
    });
  }

  receive(frame: RelayFrame): void {
    if (frame.t !== 'game') return;
    const message = parseGmMessage(frame.body);
    if (!message) { this.rejectBody(frame.body); return; }
    if (message.t === 'part') { this.receivePart(message); return; }
    this.deliver(message);
  }

  private deliver(message: GmMessage): void {
    const current = this.options.store.getState().scene;
    if (current?.scene.personal && 'scene' in message && typeof message.scene === 'string' &&
      ['tokens', 'fog', 'sight', 'lighting', 'mine', 'grid', 'doors', 'sensed', 'pins', 'annotations', 'rules', 'agency', 'live', 'delta', 'explored'].includes(message.t)) return;
    if (message.t === 'picture') { this.receivePicture(message); return; }
    if (message.t === 'picture-resync') { this.requestPicture(message.scene); return; }
    if (message.t === 'delta') { this.receiveDelta(message); return; }
    if (this.isSequenced(message)) {
      if (this.options.store.getState().scene?.scene.id !== message.scene) return;
      this.deltas.read(message);
      this.invalid.delete(message.t);
      this.channelResync.delete(message.t);
      this.options.onResyncComplete?.(message.scene, message.t);
      this.options.store.getState().applySceneMessage(message);
      this.options.onMessage?.(message);
      return;
    }
    this.route(message);
  }
  clear(): void {
    this.resetAssemblies();
    this.deltas = new DeltaReader();
    this.invalid.clear();
    this.channelResync.clear();
    this.pictureResyncPending = false;
  }

  destroy(): void {
    this.clear();
    this.unsubscribe();
  }

  private route(message: GmMessage): void {
    const state = this.options.store.getState();
    if ('scene' in message && typeof message.scene === 'string' && message.scene !== state.scene?.scene.id) return;
    if (message.t === 'scene') {
      state.applySceneMessage(message);
      this.deltas = new DeltaReader();
      this.invalid.clear();
      this.channelResync.clear();
      this.pictureResyncPending = false;
      this.options.onMessage?.(message);
      return;
    }
    if (message.t === 'log' || message.t === 'log-entry' || message.t === 'log-remove') state.setLog(message);
    else if (message.t === 'people') state.setPeople(message);
    else if (message.t === 'book' || message.t === 'book-sheet' || message.t === 'book-item' || message.t === 'book-map' || message.t === 'book-quests') state.setBook(message);
    else if (message.t === 'shown-image') state.setShownImage(message);
    else if ('scene' in message && state.scene?.scene.id === message.scene) {
      state.applySceneMessage(message);
      if (message.t === 'claim-result' || message.t === 'path-result' || message.t === 'door-result' || message.t === 'initiative-refused') {
        state.recordAgencyResponse(message as AgencyResponse);
      } else if (message.t === 'move-refused') {
        state.setPrediction(message.id, null);
        state.appendFeedback({ scene: message.scene, request: message.id, status: 'refused', reason: 'move' });
      }
    } else if (message.t === 'roll-refused' && state.scene !== null) {
      state.appendFeedback({ scene: state.scene.scene.id, request: 'roll', status: 'refused', reason: message.reason });
    }
    this.options.onMessage?.(message);
  }

  private receiveDelta(message: Extract<GmMessage, { readonly t: 'delta' }>): void {
    if (this.options.store.getState().scene?.scene.id !== message.scene) return;
    if (this.invalid.has(message.of)) { this.markGap(message.scene, message.of); return; }
    const next = this.deltas.read(message);
    if (next === 'gap') { this.markGap(message.scene, message.of); return; }
    if (next === null || next.t === 'delta') return;
    if (next.t === 'tokens' || next.t === 'fog' || next.t === 'sight') this.options.onResyncComplete?.(next.scene, next.t);
    this.options.store.getState().applySceneMessage(next);
    this.options.onMessage?.(next);
  }

  private receivePicture(message: Extract<GmMessage, { readonly t: 'picture' }>): void {
    const state = this.options.store.getState();
    if (state.scene?.scene.id !== message.scene) return;
    if (!message.whole && message.revision <= state.scene.pictureRevision) return;
    if (message.whole && !state.scene.covered && message.revision < state.scene.pictureRevision) return;
    if (!message.whole && (this.pictureResyncPending || state.scene.pictureRevision === 0 || message.revision !== state.scene.pictureRevision + 1)) {
      this.requestPicture(message.scene);
      return;
    }
    const reader = message.whole ? new DeltaReader() : this.deltas.fork();
    const channels: Partial<Record<PictureChannel, GmMessage>> = {};
    for (const child of message.messages as readonly PictureMessage[]) {
      const resolved = reader.read(child);
      if (resolved === 'gap' || resolved === null || resolved.t === 'delta') {
        this.coverScene(message.scene);
        this.requestPicture(message.scene);
        return;
      }
      channels[resolved.t as PictureChannel] = resolved;
    }
    this.deltas = reader;
    this.invalid.clear();
    this.channelResync.clear();
    this.pictureResyncPending = false;
    this.options.store.getState().commitPicture(message.scene, message.revision, message.whole, channels);
    if (message.whole) {
      this.options.onResyncComplete?.(message.scene, 'picture');
      this.options.onResyncComplete?.(message.scene, 'tokens');
      this.options.onResyncComplete?.(message.scene, 'fog');
      this.options.onResyncComplete?.(message.scene, 'sight');
    }
    for (const child of Object.values(channels)) if (child !== undefined) this.options.onMessage?.(child);
  }

  private receivePart(message: Extract<GmMessage, { readonly t: 'part' }>): void {
    this.expireParts();
    const generation = this.options.store.getState().generation;
    const assembly = this.assemblies.get(message.id);
    if (assembly && assembly.count !== message.count) {
      this.dropAssembly(message.id);
      return;
    }
    if (this.assemblies.size >= 4 && assembly === undefined) return;
    const bytes = this.decodeBase64(message.data);
    if (bytes === null || bytes.byteLength > PART_BYTES) { this.dropAssembly(message.id); return; }
    const target = assembly ?? { count: message.count, generation, created: this.now(), bytes: new Array<Uint8Array | undefined>(message.count).fill(undefined), size: 0, timer: null };
    if (assembly === undefined) target.timer = this.timers.setTimeout(() => this.dropAssembly(message.id), PART_TTL);
    const existing = target.bytes[message.index];
    if (existing !== undefined) {
      if (!this.equal(existing, bytes)) this.dropAssembly(message.id);
      return;
    }
    if (this.totalPartBytes + bytes.byteLength > PART_LIMIT) { this.dropAssembly(message.id); return; }
    target.bytes[message.index] = bytes;
    target.size += bytes.byteLength;
    this.totalPartBytes += bytes.byteLength;
    this.assemblies.set(message.id, target);
    if (target.bytes.some((entry) => entry === undefined)) return;
    const joined = new Uint8Array(target.size);
    let offset = 0;
    for (const part of target.bytes) {
      if (part === undefined) return;
      joined.set(part, offset);
      offset += part.byteLength;
    }
    this.dropAssembly(message.id);
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(joined);
      const body: unknown = JSON.parse(decoded);
      const complete = parseGmMessage(body);
      if (complete === null) {
        if (target.generation === this.options.store.getState().generation) this.rejectBody(body);
        return;
      }
      if (complete.t === 'part') return;
      const state = this.options.store.getState();
      if ((this.isSceneScoped(complete) || complete.t === 'scene') && target.generation !== state.generation) return;
      if (this.isSceneScoped(complete) && complete.scene !== state.scene?.scene.id) return;
      this.deliver(complete);
    } catch { return; }
  }

  private rejectBody(body: unknown): void {
    if (typeof body !== 'object' || body === null || !('t' in body) || !('scene' in body)) return;
    const scene = this.options.store.getState().scene;
    if (!scene || body.scene !== scene.scene.id) return;
    if (body.t === 'picture' || scene.scene.personal) {
      this.requestPicture(scene.scene.id);
    } else if (body.t === 'tokens' || body.t === 'fog' || body.t === 'sight') {
      this.markGap(scene.scene.id, body.t);
    } else if (body.t === 'lighting') {
      this.options.store.setState({ scene: { ...scene, lighting: null, covered: true } });
      this.requestPicture(scene.scene.id);
    }
  }

  private markGap(scene: string, of: DeltaOf): void {
    if (!this.invalid.has(of)) {
      this.invalid.add(of);
      const current = this.options.store.getState().scene;
      if (current?.scene.id === scene) this.options.store.setState({ scene: { ...current, [of]: null, covered: true } });
    }
    if (!this.channelResync.has(of) && this.options.send({ t: 'resync', scene, of })) this.channelResync.add(of);
  }

  private requestPicture(scene: string): void {
    if (this.options.store.getState().scene?.scene.id !== scene) return;
    this.coverScene(scene);
    if (this.pictureResyncPending) return;
    this.pictureResyncPending = this.options.send({ t: 'picture-resync', scene });
  }

  private coverScene(scene: string): void {
    const current = this.options.store.getState().scene;
    if (current?.scene.id === scene && !current.covered) this.options.store.setState({ scene: { ...current, covered: true } });
  }

  private expireParts(): void {
    for (const [id, item] of this.assemblies) if (this.now() - item.created >= PART_TTL) this.dropAssembly(id);
  }

  private dropAssembly(id: string): void {
    const item = this.assemblies.get(id);
    if (item === undefined) return;
    this.timers.clearTimeout(item.timer);
    this.totalPartBytes -= item.size;
    this.assemblies.delete(id);
  }

  private resetAssemblies(): void {
    for (const id of this.assemblies.keys()) this.dropAssembly(id);
    this.totalPartBytes = 0;
  }

  private decodeBase64(value: string): Uint8Array | null {
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes;
    } catch { return null; }
  }

  private equal(first: Uint8Array, second: Uint8Array): boolean {
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) return false;
    return true;
  }

  private isSequenced(message: GmMessage): message is Extract<GmMessage, { readonly t: 'tokens' | 'fog' | 'sight' }> {
    return message.t === 'tokens' || message.t === 'fog' || message.t === 'sight';
  }

  private isSceneScoped(message: GmMessage): message is Extract<GmMessage, { readonly scene: string }> {
    return 'scene' in message && typeof message.scene === 'string';
  }
}
