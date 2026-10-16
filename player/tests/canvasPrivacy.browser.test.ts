import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Application, Container, Graphics, RenderTexture, Sprite, Texture, type WebGLRenderer } from 'pixi.js';
import { installDomHost } from '../../src/app/host/dom.ts';
import { PlayerFog } from '../src/canvas/PlayerFog.ts';
import { PlayerMap } from '../src/canvas/PlayerMap.ts';
import { PlayerSceneModel } from '../src/canvas/sceneModel.ts';
import { createPlayerStore, type PlayerSceneState, type PlayerState } from '../src/state/playerStore.ts';
import { PlayerCanvas, type PlayerCanvasOptions } from '../src/canvas/PlayerCanvas.ts';
import { PlayerMemory } from '../src/canvas/PlayerMemory.ts';
import type { AssetDownloads, ExploredMemoryKey } from '../src/state/interfaces.ts';
import type { SharedGrid, SensedMark } from '../../src/app/online/protocol/mapLayers.ts';
import type { SightToken } from '../../src/app/online/protocol/lighting.ts';
import type { SharedToken } from '../../src/app/online/protocol/tokens.ts';
import type { StoreApi } from 'zustand/vanilla';
import { pointInPolygon } from '../../src/app/vision/visibility.ts';
import type { AssetRef } from '../../src/app/online/protocol/asset.ts';
interface CanvasFixture {
  readonly canvas: PlayerCanvas;
  readonly host: HTMLDivElement;
  readonly store: StoreApi<PlayerState>;
}

async function canvasFixture(blob: Blob, width: number, height: number, send: PlayerCanvasOptions['send'] = () => true): Promise<CanvasFixture> {
  const assets: AssetDownloads = {
    request: async () => blob, metadataFor: () => ({ width, height }), release: () => undefined,
    setAuthorized: () => undefined, receive: () => undefined, resetTransport: () => undefined, clearExplored: async () => undefined,
    exploredStore: { get: async () => null, writeEpoch: () => 0, put: async () => undefined, deleteFor: async () => undefined },
  };
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(host);
  const canvas = await PlayerCanvas.create({ host, assets, send, table: 'table' });
  return { canvas, host, store: createPlayerStore() };
}
function stagePixels(canvas: PlayerCanvas, width: number, height: number): Uint8ClampedArray {
  const target = RenderTexture.create({ width, height, antialias: false });
  try {
    canvas.app.renderer.render({ container: canvas.app.stage, target, clear: true });
    return canvas.app.renderer.extract.pixels({ target }).pixels;
  } finally {
    target.destroy(true);
  }
}
function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): readonly [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!];
}

function commitPersonalPicture(
  store: StoreApi<PlayerState>,
  scene: string,
  token: SharedToken,
  source: SightToken,
  owned: boolean,
  grid: SharedGrid | null,
  sensed: readonly SensedMark[] = [],
): void {
  store.getState().commitPicture(scene, 1, true, {
    tokens: { t: 'tokens', scene, tokens: [token], cell: 25, snap: null },
    fog: { t: 'fog', scene, fog: [] },
    lighting: { t: 'lighting', scene, cellSize: 25, unitDistance: 5, walls: [], zones: [], senses: [] },
    sight: { t: 'sight', scene, lighting: { ambient: 1 }, lights: [], tokens: [source], held: [] },
    mine: { t: 'mine', scene, tokens: owned ? [token.id] : [] },
    grid: { t: 'grid', scene, grid },
    doors: { t: 'doors', scene, doors: [] },
    sensed: { t: 'sensed', scene, tokens: [...sensed] },
    pins: { t: 'pins', scene, pins: [] },
    annotations: { t: 'annotations', scene, drawings: [], texts: [] },
  });
}
function showPersonalView(
  canvas: PlayerCanvas,
  store: StoreApi<PlayerState>,
  map: AssetRef,
  scene: string,
  player: string,
  token: SharedToken,
  source: SightToken,
  owned: boolean,
  sensed: readonly SensedMark[] = [],
): void {
  store.getState().setConnection(player, player, true);
  store.getState().beginScene({ id: scene, lit: true, personal: true, memoryId: 'f'.repeat(24), map });
  canvas.update(store.getState());
  commitPersonalPicture(store, scene, token, source, owned, null, sensed);
  canvas.update(store.getState());
}
const restore = installDomHost({
  createCanvas: (doc = document, size) => { const canvas = doc.createElement('canvas'); if (size) { canvas.width = size.width; canvas.height = size.height; } return canvas; },
  createDiv: (parent, cls) => { const div = parent.ownerDocument.createElement('div'); div.className = cls; parent.appendChild(div); return div; },
  ownerWindow: (node) => node.ownerDocument?.defaultView ?? window,
  activeDocument: () => document,
});
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
afterAll(restore);

function scene(personal = true): PlayerSceneState {
  const store = createPlayerStore();
  store.getState().beginScene({ id: 'view', lit: true, personal: personal ? true : undefined, memoryId: 'a'.repeat(24), map: null });
  store.getState().applySceneMessage({ t: 'lighting', scene: 'view', cellSize: 70, unitDistance: 5, walls: [], zones: [], senses: [] });
  store.getState().applySceneMessage({ t: 'sight', scene: 'view', lighting: { ambient: 1 }, lights: [], tokens: [], held: [] });
  return store.getState().scene!;
}

describe('browser canvas privacy inputs', () => {
  it('covers every displayed centre while fog is null and releases only uncovered centres', () => {
    const fog = new PlayerFog(); cleanups.push(() => fog.destroy());
    fog.update(null, 400, 300, 'one');
    expect(fog.visible({ x: 200, y: 150 })).toBe(false);
    fog.update([{ type: 'rectangle', erase: false, x: 0, y: 0, width: 200, height: 300 }], 400, 300, 'one');
    expect(fog.visible({ x: 100, y: 100 })).toBe(false);
    expect(fog.visible({ x: 300, y: 100 })).toBe(true);
    fog.update([], 400, 300, 'two');
    expect(fog.visible({ x: 100, y: 100 })).toBe(true);
  });
  it('detaches a destroyed grid mask before player pointer hit testing and keeps drag input live', async () => {
    const source = new OffscreenCanvas(100, 100);
    const context = source.getContext('2d')!;
    context.fillStyle = '#00aa55';
    context.fillRect(0, 0, 100, 100);
    const blob = await source.convertToBlob({ type: 'image/png' });
    const map = { hash: 'a'.repeat(64), size: blob.size, mime: blob.type };
    const sent: unknown[] = [];
    const { canvas, host, store } = await canvasFixture(blob, 100, 100, (message) => (sent.push(message), true));
    cleanups.push(() => { canvas.destroy(); host.remove(); });
    store.getState().setConnection('alice', 'Alice', true);
    const grid = { type: 'square' as const, size: 25, offsetX: 0, offsetY: 0, colour: '#ffffff', alpha: 1, lineWidth: 1, lineType: 'solid' as const, numbers: null };
    store.getState().beginScene({ id: 'shared', lit: false, map });
    store.getState().applySceneMessage({ t: 'tokens', scene: 'shared', tokens: [], cell: 25, snap: null });
    store.getState().applySceneMessage({ t: 'fog', scene: 'shared', fog: [] });
    store.getState().applySceneMessage({ t: 'grid', scene: 'shared', grid });
    canvas.update(store.getState());
    const world = canvas.viewport.children[0];
    if (!(world instanceof Container)) throw new Error('Player world is missing.');
    const gridContainer = world.children[0];
    if (!(gridContainer instanceof Container)) throw new Error('Player grid layer is missing.');
    await vi.waitFor(() => {
      expect(gridContainer.children.some((child) => child instanceof Container && child.mask != null)).toBe(true);
      const pixels = stagePixels(canvas, 100, 100);
      expect(pixels[(12 * 100 + 12) * 4 + 1]).toBeGreaterThan(pixels[(12 * 100 + 12) * 4]);
    }, { timeout: 10_000 });
    const lineCandidate = gridContainer.children.find((child) => child instanceof Container && child.mask != null);
    if (!(lineCandidate instanceof Container)) throw new Error('Player grid mask container is missing.');
    const lines = lineCandidate;
    const oldMask = lines.mask;
    if (!(oldMask instanceof Graphics)) throw new Error('Player grid mask Graphics is missing.');
    const errors: string[] = [];
    const onError = (event: ErrorEvent): void => { errors.push(event.message); event.preventDefault(); };
    const viewportMoves = vi.fn();
    window.addEventListener('error', onError);
    canvas.viewport.on('pointermove', viewportMoves);
    try {
      store.getState().beginScene({ id: 'personal', lit: true, personal: true, memoryId: 'b'.repeat(24), map });
      canvas.update(store.getState());
      expect(lines.mask).toBeFalsy();
      expect(oldMask.destroyed).toBe(true);
      const covered = stagePixels(canvas, 100, 100);
      expect(Array.from(covered.slice((12 * 100 + 12) * 4, (12 * 100 + 12) * 4 + 4))).toEqual([0, 0, 0, 255]);
      canvas.app.canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, pointerId: 1 }));
      expect(errors).toEqual([]);
      expect(viewportMoves).toHaveBeenCalled();
      const id = 'c'.repeat(24);
      const token = { id, x: 12, y: 12, size: 20, cells: 1, rotation: 0, art: null, name: 'Hero', ring: { colour: '#ffffff', size: 30 }, claim: 'taken' as const, badge: null, ui: null };
      commitPersonalPicture(store, 'personal', token, { id, x: 12, y: 12, size: 1, vision: { senses: [], sightRange: 1 } }, true, grid);
      canvas.update(store.getState());
      await vi.waitFor(() => {
        expect(lines.mask).not.toBeNull();
        const pixels = stagePixels(canvas, 100, 100);
        const sourcePixel = pixelAt(pixels, 100, 12, 12);
        expect(sourcePixel[0] + sourcePixel[1] + sourcePixel[2]).toBeGreaterThan(100);
      }, { timeout: 10_000 });
      const alicePixels = stagePixels(canvas, 100, 100);
      const aliceSource = pixelAt(alicePixels, 100, 12, 12);
      const aliceOutside = pixelAt(alicePixels, 100, 80, 80);
      expect(aliceSource[0] + aliceSource[1] + aliceSource[2]).toBeGreaterThan(aliceOutside[0] + aliceOutside[1] + aliceOutside[2] + 50);
      store.getState().applySceneMessage({ t: 'fog', scene: 'personal', fog: null });
      canvas.update(store.getState());
      const coveredByFog = stagePixels(canvas, 100, 100);
      expect(Array.from(coveredByFog.slice((12 * 100 + 12) * 4, (12 * 100 + 12) * 4 + 4))).toEqual([0, 0, 0, 255]);
      store.getState().applySceneMessage({ t: 'fog', scene: 'personal', fog: [] });
      canvas.update(store.getState());
      await vi.waitFor(() => {
        const restored = stagePixels(canvas, 100, 100);
        expect(restored[(12 * 100 + 12) * 4 + 1]).toBeGreaterThan(restored[(12 * 100 + 12) * 4]);
      }, { timeout: 10_000 });
      const capture = vi.spyOn(canvas.app.canvas, 'setPointerCapture').mockImplementation(() => undefined);
      cleanups.push(() => capture.mockRestore());
      canvas.app.canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 12, clientY: 12, pointerId: 2, button: 0 }));
      canvas.app.canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: 16, clientY: 16, pointerId: 2, buttons: 1 }));
      canvas.app.canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, pointerId: 2, button: 0 }));
      expect(capture).toHaveBeenCalledWith(2);
      expect(sent.some((message) => typeof message === 'object' && message !== null && 't' in message && message.t === 'move')).toBe(true);
      expect(errors).toEqual([]);
      const bobId = 'd'.repeat(24);
      const bobToken: SharedToken = { id: bobId, x: 80, y: 80, size: 20, cells: 1, rotation: 0, art: null, name: null, ring: null, claim: 'taken', badge: null, ui: null };
      showPersonalView(canvas, store, map, 'bob-view', 'bob', bobToken, { id: bobId, x: 80, y: 80, size: 1, vision: { senses: [], sightRange: 1 } }, true);
      await vi.waitFor(() => {
        const pixels = stagePixels(canvas, 100, 100);
        expect(pixelAt(pixels, 100, 80, 80)[1]).toBeGreaterThan(pixelAt(pixels, 100, 80, 80)[0]);
      }, { timeout: 10_000 });
      const bobPixels = stagePixels(canvas, 100, 100);
      const bobSource = pixelAt(bobPixels, 100, 80, 80);
      const bobAlicePlace = pixelAt(bobPixels, 100, 12, 12);
      expect(bobSource[1]).toBeGreaterThan(bobSource[0]);
      expect(bobAlicePlace[0] + bobAlicePlace[1] + bobAlicePlace[2]).toBeLessThan(aliceSource[0] + aliceSource[1] + aliceSource[2]);
      const foreignId = 'e'.repeat(24);
      const foreignToken: SharedToken = { id: foreignId, x: 50, y: 50, size: 20, cells: 1, rotation: 0, art: null, name: null, ring: null, claim: 'taken', badge: null, ui: null };
      const sensed: SensedMark[] = [{ x: 80, y: 80, size: 20 }, { x: 80, y: 30, size: 20 }];
      showPersonalView(canvas, store, map, 'carol-view', 'carol', foreignToken, { id: foreignId, x: 50, y: 50, size: 1, alwaysSeen: true }, false, sensed);
      await vi.waitFor(() => {
        const pixels = stagePixels(canvas, 100, 100);
        expect(pixelAt(pixels, 100, 50, 50)[1]).toBeGreaterThan(pixelAt(pixels, 100, 50, 50)[0]);
      }, { timeout: 10_000 });
      const carolPixels = stagePixels(canvas, 100, 100);
      const footprint = pixelAt(carolPixels, 100, 50, 50);
      const outside = pixelAt(carolPixels, 100, 12, 12);
      expect(footprint[0] + footprint[1] + footprint[2]).toBeGreaterThan(outside[0] + outside[1] + outside[2] + 50);
      const outline = pixelAt(carolPixels, 100, 89, 80);
      expect(outline[0] + outline[1] + outline[2]).toBeGreaterThan(outside[0] + outside[1] + outside[2] + 100);
      store.getState().applySceneMessage({ t: 'sensed', scene: 'carol-view', tokens: [{ x: 80, y: 30, size: 20 }, { x: 80, y: 80, size: 20 }] });
      canvas.update(store.getState());
      expect(stagePixels(canvas, 100, 100)).toEqual(carolPixels);
      store.getState().applySceneMessage({ t: 'grid', scene: 'carol-view', grid });
      canvas.update(store.getState());
      await vi.waitFor(() => expect(lines.mask).not.toBeNull(), { timeout: 10_000 });
      canvas.destroy();
      expect(lines.mask).toBeFalsy();
    } finally {
      window.removeEventListener('error', onError);
      canvas.viewport.off('pointermove', viewportMoves);
    }
  });
  it('has no personal source fallback but preserves explicitly disabled token vision', () => {
    const source = scene(); const model = new PlayerSceneModel();
    expect(model.build(source, 400, 300)?.model.sight.all).toBe(false);
    const disabled = { ...source, sight: { ...source.sight!, lighting: { ambient: 1, tokenVision: false } } };
    expect(model.build(disabled, 400, 300)?.model.sight.all).toBe(true);
    expect(model.build({ ...disabled, sight: { ...disabled.sight, blind: true } }, 400, 300)?.model.sight.all).toBe(false);
  });
  it('keeps pending sources closed and preserves their held positions', () => {
    const source = scene();
    const pending = { ...source, sight: { ...source.sight!, tokens: [{ id: 'a'.repeat(24), x: 100, y: 100, size: 1, vision: { senses: [], pending: true as const } }], held: [{ id: 'a'.repeat(24), x: 30, y: 40 }] } };
    const built = new PlayerSceneModel().build(pending, 400, 300)!;
    expect(built.model.sight.regions).toHaveLength(0);
    expect(built.state.heldTokens['a'.repeat(24)]).toEqual({ x: 30, y: 40 });
  });
  it('separates two rooms and gives a foreign always-seen PC only its footprint', () => {
    const base = scene();
    const source = { ...base, lighting: { ...base.lighting!, walls: [{ p: [200, 0, 200, 300] as const }] }, sight: { ...base.sight!, tokens: [
      { id: 'a'.repeat(24), x: 100, y: 150, size: 1, vision: { senses: [] } },
      { id: 'b'.repeat(24), x: 300, y: 150, size: 1, alwaysSeen: true as const },
    ] } };
    const result = new PlayerSceneModel().build(source, 400, 300)!;
    const sees = (x: number): boolean => result.model.sight.regions.some((region) => region.polygon !== null && pointInPolygon({ x, y: 150 }, region.polygon));
    expect(sees(100)).toBe(true);
    expect(sees(300)).toBe(false);
    expect(result.spots.some((spot) => spot.x === 300 && spot.y === 150)).toBe(true);
    expect(result.model.sight.regions.every((region) => region.tokenId !== 'b'.repeat(24))).toBe(true);
    const other = { ...source, sight: { ...source.sight, tokens: [{ id: 'b'.repeat(24), x: 300, y: 150, size: 1, vision: { senses: [] } }] } };
    const otherResult = new PlayerSceneModel().build(other, 400, 300)!;
    expect(otherResult.model.sight.regions.some((region) => region.polygon !== null && pointInPolygon({ x: 100, y: 150 }, region.polygon))).toBe(false);
  });
  it('opens an image wider than common GPU limits through tile geometry and closes pending work', async () => {
    const app = new Application();
    await app.init({ width: 128, height: 64, preference: 'webgl', antialias: false, backgroundAlpha: 0 });
    if (app.renderer.name !== 'webgl') throw new Error('The wide-map tile test requires WebGL.');
    const renderer = app.renderer as WebGLRenderer;
    const maxTextureSize = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE);
    const width = Math.ceil(Math.max(20_000, maxTextureSize + 1) / 2) * 2;
    expect(width).toBeGreaterThan(maxTextureSize);
    const source = new OffscreenCanvas(width, 64);
    const context = source.getContext('2d')!;
    context.fillStyle = '#cc2200'; context.fillRect(0, 0, width / 2, 64);
    context.fillStyle = '#0066cc'; context.fillRect(width / 2, 0, width / 2, 64);
    const blob = await source.convertToBlob({ type: 'image/png' });
    const ticker = app.ticker;
    const unavailable = vi.fn();
    const map = new PlayerMap({ blob, byteHash: 'a'.repeat(64), originalWidth: width, originalHeight: 64, ticker, renderer, requestRender: () => undefined, onUnavailable: unavailable });
    cleanups.push(() => { map.destroy(); app.destroy(true); });
    const overview = await map.overview(2048);
    expect(overview.width).toBeLessThanOrEqual(2048); expect(overview.width).toBeGreaterThan(0); overview.close();
    await map.update({ x: width - 128, y: 0, width: 128, height: 64, worldPerScreenPixel: 1 });
    expect(map.container.children[0]?.boundsArea?.width).toBe(width);
    map.container.x = -(width - 128);
    app.stage.addChild(map.container);
    await vi.waitFor(() => {
      const layer = map.container.children[0];
      if (!(layer instanceof Container)) throw new Error('Map tile layer is missing.');
      const finest = layer.children.find((child) => child instanceof Container && child.scale.x === 1 && child.scale.y === 1);
      if (!(finest instanceof Container)) throw new Error('Full-resolution tile level is missing.');
      const tiles = finest.children.filter((child): child is Sprite => child instanceof Sprite && child.visible && child.alpha > 0.99);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.every((tile) => tile.texture.width <= 512 && tile.texture.height <= 512)).toBe(true);
    }, { timeout: 15_000 });
    const target = RenderTexture.create({ width: 128, height: 64, antialias: false });
    try {
      renderer.render({ container: app.stage, target, clear: true });
      const pixels = renderer.extract.pixels({ target }).pixels;
      const rightmost = pixelAt(pixels, 128, 20, 32);
      expect(rightmost[2]).toBeGreaterThan(rightmost[0]);
    } finally {
      target.destroy(true);
    }
    expect(unavailable).not.toHaveBeenCalled();
    map.destroy();
    await expect(map.overview(512)).rejects.toThrow();
  });
  it('keeps the map black until whole inputs arrive and during context restoration', async () => {
    const image = new OffscreenCanvas(400, 300);
    const context = image.getContext('2d')!;
    context.fillStyle = '#00aa55'; context.fillRect(0, 0, 400, 300);
    const blob = await image.convertToBlob({ type: 'image/png' });
    const { canvas, host, store } = await canvasFixture(blob, 400, 300);
    cleanups.push(() => { canvas.destroy(); host.remove(); });
    const stop = store.subscribe((state) => canvas.update(state));
    cleanups.push(stop);
    store.getState().setConnection('alice', 'Alice', true);
    store.getState().beginScene({ id: 'view', lit: false, map: { hash: 'a'.repeat(64), size: blob.size, mime: blob.type } });
    const cover = canvas.app.stage.getChildByLabel('player-privacy-cover', true)!;
    expect(cover.visible).toBe(true);
    store.getState().applySceneMessage({ t: 'tokens', scene: 'view', tokens: [], cell: 70, snap: null });
    store.getState().applySceneMessage({ t: 'fog', scene: 'view', fog: [] });
    await vi.waitFor(() => expect(cover.visible).toBe(false));
    await vi.waitFor(() => {
      const pixels = stagePixels(canvas, 400, 300);
      expect(pixelAt(pixels, 400, 200, 150)[1]).toBeGreaterThan(pixelAt(pixels, 400, 200, 150)[0]);
    }, { timeout: 10_000 });
    const renderer = canvas.app.renderer;
    if (renderer.name !== 'webgl') throw new Error('The context lifecycle test requires WebGL.');
    const webgl = renderer as WebGLRenderer;
    const contextLoss = webgl.gl.getExtension('WEBGL_lose_context');
    if (!contextLoss) throw new Error('The browser does not expose WEBGL_lose_context.');
    let lost = false;
    canvas.app.canvas.addEventListener('webglcontextlost', () => { lost = true; }, { once: true });
    contextLoss.loseContext();
    await vi.waitFor(() => expect(lost).toBe(true), { timeout: 10_000 });
    expect(cover.visible).toBe(true);
    let restored = false;
    canvas.app.canvas.addEventListener('webglcontextrestored', () => { restored = true; }, { once: true });
    contextLoss.restoreContext();
    await vi.waitFor(() => expect(restored).toBe(true), { timeout: 10_000 });
    await vi.waitFor(() => expect(cover.visible).toBe(false));
    await vi.waitFor(() => {
      const pixels = stagePixels(canvas, 400, 300);
      expect(pixelAt(pixels, 400, 200, 150)[1]).toBeGreaterThan(pixelAt(pixels, 400, 200, 150)[0]);
    }, { timeout: 10_000 });
    store.getState().beginTransportGeneration();
    expect(cover.visible).toBe(true);
  });
  it('restores memory before showing it and saves lossless original-geometry rows on pagehide', async () => {
    const app = new Application(); await app.init({ width: 100, height: 100, preference: 'webgl' });
    const rows = new Map<string, Blob>();
    const key: ExploredMemoryKey = { table: 'table', player: 'alice', memoryId: 'a'.repeat(24), mapHash: 'b'.repeat(64), geometry: JSON.stringify([400, 300]) };
    const writes: ExploredMemoryKey[] = [];
    let reads = 0;
    let lastRead: Blob | null = null;
    const store = {
      get: async (value: ExploredMemoryKey): Promise<Blob | null> => { ++reads; lastRead = rows.get(JSON.stringify(value)) ?? null; return lastRead; },
      writeEpoch: (): number => 0,
      put: async (value: ExploredMemoryKey, png: Blob, _epoch: number): Promise<void> => { writes.push(value); rows.set(JSON.stringify(value), png); },
      deleteFor: async (table: string, player: string): Promise<void> => { if (key.table === table && key.player === player) rows.delete(JSON.stringify(key)); },
    };
    const memory = new PlayerMemory(app.renderer, store, () => undefined, vi.fn());
    cleanups.push(() => { memory.destroy(); app.destroy(true); });
    memory.open(key, 400, 300);
    expect(memory.texture).toBe(Texture.EMPTY);
    await vi.waitFor(() => expect(memory.texture).not.toBe(Texture.EMPTY));
    memory.record({ polygons: [[{ x: 10, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 150 }, { x: 10, y: 150 }]], clip: null });
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(rows.size).toBe(1));
    expect(writes[0]).toEqual(key);
    const bitmap = await createImageBitmap(rows.values().next().value!);
    expect([bitmap.width, bitmap.height]).toEqual([400, 300]); bitmap.close();
    memory.close(); memory.open(key, 400, 300);
    expect(memory.texture).toBe(Texture.EMPTY);
    await vi.waitFor(() => expect(memory.texture).not.toBe(Texture.EMPTY));
    expect(memory.texture.width).toBe(400);
    const priorReads = reads;
    await store.deleteFor(key.table, key.player);
    expect(rows.size).toBe(0);
    memory.close(false);
    memory.open(key, 400, 300);
    await vi.waitFor(() => expect(reads).toBe(priorReads + 1));
    expect(lastRead).toBeNull();
  });
});
