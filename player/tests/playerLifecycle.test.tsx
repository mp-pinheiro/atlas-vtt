import { closeDom } from './domSetup.ts';
import { createRoot } from 'react-dom/client';
import { TableLog } from '../src/ui/TableLog.tsx';
import { act, createElement } from 'react';
import { Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef } from '../../src/app/online/protocol/asset.ts';
import type { PlayerState } from '../src/state/playerStore.ts';
import { AssetDownloads } from '../src/assets/assetDownloads.ts';
import { createPlayerRuntime } from '../src/ui/playerRuntime.ts';
import { PlayerMemory } from '../src/canvas/PlayerMemory.ts';
import type { ExploredMemoryKey } from '../src/state/interfaces.ts';
import type { ExploredShapes } from '../../src/app/vision/exploredShapes.ts';
import { PlayerCanvas } from '../src/canvas/PlayerCanvas.ts';
import { LogState } from '../../src/app/online/tableLog/LogState.ts';

const memoryEncodes = vi.hoisted(() => ({ callbacks: [] as ((blob: Blob | null) => void)[] }));
vi.mock('../../src/app/pixi/lighting/ExploredTexture.ts', () => ({
  ExploredTexture: class {
    readonly texture = {};
    async decode(): Promise<{ destroy(): void }> { return { destroy() {} }; }
    add(): void {}
    draw(): void {}
    toCanvas(): { toBlob(callback: (blob: Blob | null) => void): void } {
      return { toBlob: (callback) => memoryEncodes.callbacks.push(callback) };
    }
    destroy(): void {}
  },
}));

type Deferred<T> = { readonly promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };
function deferred<T>(): Deferred<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface CanvasArtRow { users: number; texture: Texture | null; bitmap: ImageBitmap | null; promise: Promise<Texture> }
interface CanvasResourceHarness {
  readonly art: Map<string, CanvasArtRow>;
  acquire(ref: AssetRef): Promise<Texture>;
  release(ref: AssetRef): void;
}
interface MapCanvasHarness {
  readonly mapHash: string | null;
  readonly map: unknown;
  readonly assetRequestCount: { value: number };
  update(state: PlayerState): void;
}


class MemoryStorage implements Storage {
  private readonly rows = new Map<string, string>();
  get length(): number { return this.rows.size; }
  clear(): void { this.rows.clear(); }
  getItem(key: string): string | null { return this.rows.get(key) ?? null; }
  key(index: number): string | null { return [...this.rows.keys()][index] ?? null; }
  removeItem(key: string): void { this.rows.delete(key); }
  setItem(key: string, value: string): void { this.rows.set(key, value); }
}

const key: ExploredMemoryKey = {
  table: 'abcdefghijklmnopqrstuvwx23', player: 'abcdefghijklmnopqrst', memoryId: 'a'.repeat(24),
  mapHash: 'b'.repeat(64), geometry: '[400,300]',
};
const imageRef: AssetRef = { hash: 'c'.repeat(64), size: 12, mime: 'image/png' };

function canvasHarness(PlayerCanvasClass: { readonly prototype: object }, request: (ref: AssetRef, maxSide?: number) => Promise<Blob>): CanvasResourceHarness {
  const canvas = Object.create(PlayerCanvasClass.prototype) as CanvasResourceHarness & { destroyed: boolean; options: unknown };
  Object.assign(canvas, {
    art: new Map<string, CanvasArtRow>(), destroyed: false,
    options: { assets: { request, release: vi.fn(), metadataFor: () => null } },
  });
  return canvas;
}

function mapCanvasHarness(PlayerCanvasClass: { readonly prototype: object }, requests: readonly Deferred<Blob>[]): MapCanvasHarness {
  let index = 0;
  const assetRequestCount = { value: 0 };
  const request = (): Promise<Blob> => {
    assetRequestCount.value++;
    return requests[index++]!.promise;
  };
  const canvas = Object.create(PlayerCanvasClass.prototype) as MapCanvasHarness & Record<string, unknown>;
  Object.assign(canvas, {
    state: null, sceneId: 'scene', map: null, mapHash: null, pendingMap: null, mapAttempt: 0,
    transportGeneration: 1, generation: 1, destroyed: false, loadingMap: false, exploredHash: null,
    mapHold: null, maskHold: null, doorRequests: new Map(), width: 1, height: 1,
    world: { visible: false }, app: { screen: { width: 800, height: 600 } },
    options: { assets: { request, release: vi.fn(), metadataFor: () => null } },
    layers: { setPeople: vi.fn(), reset: vi.fn() }, input: { update: vi.fn() },
    doors: { refuse: vi.fn() }, lighting: { reset: vi.fn(), setSharedMask: vi.fn() },
    draw: vi.fn(), noticeError: vi.fn(), assetRequestCount,
  });
  return canvas;
}

function sceneState(transportGeneration: number): PlayerState {
  return {
    transportGeneration,
    people: null,
    feedback: [],
    scene: {
      scene: { id: 'scene', lit: false, personal: true, map: imageRef },
      explored: null,
    },
  } as unknown as PlayerState;
}

describe('player resource lifecycle', () => {
  beforeEach(() => { memoryEncodes.callbacks.length = 0; });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('drops rejected token-art requests so a later scene can retry them', async () => {
    const requests = [deferred<Blob>(), deferred<Blob>()];
    let index = 0;
    const request = vi.fn(() => requests[index++]!.promise);
    const canvas = canvasHarness(PlayerCanvas, request);
    const first = canvas.acquire(imageRef).catch((error: Error) => error.message);
    const coalesced = canvas.acquire(imageRef).catch((error: Error) => error.message);
    expect(request).toHaveBeenCalledTimes(1);
    requests[0]!.reject(new Error('Transport generation changed'));
    expect(await Promise.all([first, coalesced])).toEqual(['Transport generation changed', 'Transport generation changed']);
    expect(canvas.art.size).toBe(0);
    const retry = canvas.acquire(imageRef).catch((error: Error) => error.message);
    expect(request).toHaveBeenCalledTimes(2);
    requests[1]!.reject(new Error('Asset unavailable'));
    expect(await retry).toBe('Asset unavailable');
    expect(canvas.art.size).toBe(0);
  });

  it('preserves shared art references and a newer owner when an old load settles late', async () => {
    const resolved = deferred<Blob>();
    const request = vi.fn(() => resolved.promise);
    const canvas = canvasHarness(PlayerCanvas, request);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const texture = { destroy: vi.fn() } as unknown as Texture;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const textureFactory = vi.spyOn(Texture, 'from').mockReturnValue(texture);
    const first = canvas.acquire(imageRef);
    const second = canvas.acquire(imageRef);
    expect(canvas.art.get(imageRef.hash)?.users).toBe(2);
    resolved.resolve(new Blob(['art']));
    expect(await first).toBe(texture);
    expect(await second).toBe(texture);
    canvas.release(imageRef);
    expect(texture.destroy).not.toHaveBeenCalled();
    canvas.release(imageRef);
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.art.has(imageRef.hash)).toBe(false);

    const lateLoads = [deferred<Blob>(), deferred<Blob>()];
    let requestIndex = 0;
    let bitmapIndex = 0;
    const lateBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const freshBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const freshTexture = { destroy: vi.fn() } as unknown as Texture;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmapIndex++ === 0 ? lateBitmap : freshBitmap));
    const lateCanvas = canvasHarness(PlayerCanvas, () => lateLoads[requestIndex++]!.promise);
    textureFactory.mockReturnValue(freshTexture);
    const stale = lateCanvas.acquire(imageRef).catch((error: Error) => error.message);
    lateCanvas.release(imageRef);
    const current = lateCanvas.acquire(imageRef);
    lateLoads[0]!.resolve(new Blob(['old']));
    expect(await stale).toBe('Token artwork was released.');
    expect(lateCanvas.art.has(imageRef.hash)).toBe(true);
    lateLoads[1]!.resolve(new Blob(['current']));
    expect(await current).toBe(freshTexture);
    expect(lateCanvas.art.get(imageRef.hash)?.users).toBe(1);
    lateCanvas.release(imageRef);
    expect(lateBitmap.close).toHaveBeenCalledTimes(1);
    expect(freshBitmap.close).toHaveBeenCalledTimes(1);
  });

  it('retries a failed initial map only after the transport generation changes', async () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const requests = [deferred<Blob>(), deferred<Blob>()];
    const canvas = mapCanvasHarness(PlayerCanvas, requests);
    canvas.update(sceneState(1));
    expect(canvas.mapHash).toBe(imageRef.hash);
    requests[0]!.reject(new Error('Transport generation changed'));
    await settle();
    canvas.update(sceneState(2));
    requests[1]!.reject(new Error('Transport generation changed'));
    await settle();
    canvas.update(sceneState(2));
    expect(canvas.map).toBeNull();
    expect(canvas.assetRequestCount.value).toBe(2);
  });

  it('forgets a stored identity before welcome and fences pending memory encodes', async () => {
    const storage = new MemoryStorage();
    storage.setItem(`atlas-player:${key.table}`, JSON.stringify({ playerId: key.player, key: 'A'.repeat(32) }));
    vi.stubGlobal('localStorage', storage);
    const windowEvents = new Map<string, EventListener>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: EventListener) => windowEvents.set(type, listener),
      removeEventListener: (type: string) => windowEvents.delete(type),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    const runtime = createPlayerRuntime(key.table, 'https://player.test');
    let restored = Promise.withResolvers<void>();
    const memory = new PlayerMemory({} as never, runtime.assets.exploredStore, () => restored.resolve(), () => undefined);
    try {
      const epoch = runtime.assets.exploredStore.writeEpoch(key);
      await runtime.assets.exploredStore.put(key, new Blob(['saved']), epoch);
      memory.open(key, 400, 300);
      await restored.promise;
      memory.record({ polygons: [], clip: null } as ExploredShapes);
      memory.close();
      expect(memoryEncodes.callbacks).toHaveLength(1);
      expect(runtime.store.getState().playerId).toBeNull();
      await runtime.leave();
      expect(runtime.identity.get()).toEqual({});
      expect(storage.getItem(`atlas-player:${key.table}`)).toBeNull();
      expect(await runtime.assets.exploredStore.get(key)).toBeNull();
      memoryEncodes.callbacks[0]!(new Blob(['pending png']));
      await settle();
      expect(await runtime.assets.exploredStore.get(key)).toBeNull();
    } finally {
      memory.destroy();
      runtime.stop();
    }
    expect(windowEvents.has('pagehide')).toBe(false);
  });

  it('saves normal scene-close and pagehide memory with the active write epoch', async () => {
    const downloads = new AssetDownloads({ indexedDB: null, send: () => true });
    const events = new Map<string, EventListener>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: EventListener) => events.set(type, listener),
      removeEventListener: (type: string) => events.delete(type),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    let restored = Promise.withResolvers<void>();
    const memory = new PlayerMemory({} as never, downloads.exploredStore, () => restored.resolve(), () => undefined);
    const firstKey = { ...key, mapHash: 'd'.repeat(64) };
    memory.open(firstKey, 400, 300);
    await restored.promise;
    memory.record({ polygons: [], clip: null } as ExploredShapes);
    memory.close();
    memoryEncodes.callbacks.shift()!(new Blob(['scene close']));
    await settle();
    expect(await (await downloads.exploredStore.get(firstKey))?.text()).toBe('scene close');
    const secondKey = { ...key, mapHash: 'e'.repeat(64) };
    restored = Promise.withResolvers<void>();
    memory.open(secondKey, 400, 300);
    await restored.promise;
    memory.record({ polygons: [], clip: null } as ExploredShapes);
    events.get('pagehide')!(new Event('pagehide'));
    memoryEncodes.callbacks.shift()!(new Blob(['pagehide']));
    await settle();
    expect(await (await downloads.exploredStore.get(secondKey))?.text()).toBe('pagehide');
    memory.destroy();
  });

  it('does not loop the table log while its scene has no token list', async () => {
    const rootElement = document.createElement('div');
    document.body.appendChild(rootElement);
    const root = createRoot(rootElement);
    const request = vi.fn(async () => new Blob());
    const logState = new LogState(() => null);
    const assets = { request, release: vi.fn() };
    const entries: readonly [] = [];
    const people: readonly [] = [];
    const mine: readonly string[] = [];
    let renders = 0;
    function Harness() {
      renders++;
      return createElement(TableLog, {
        state: logState, entries, people, refusal: null, self: null,
        scene: null, tokens: null, mine, gmOnline: false, busy: false,
        assets: assets as never,
        send: () => false, onClose: () => undefined, onSendRejected: () => undefined,
      });
    }
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    try {
      await act(async () => {
        root.render(createElement(Harness));
        await Promise.resolve();
      });
      expect(renders).toBeLessThan(4);
      expect(request).not.toHaveBeenCalled();
    } finally {
      root.unmount();
      rootElement.remove();
      closeDom();
    }
  });
});
