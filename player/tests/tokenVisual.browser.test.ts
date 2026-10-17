import { Application, CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { installDomHost } from '../../src/app/host/dom';
import { SpriteFactory } from '../../src/app/pixi/token-renderer/SpriteFactory';
import { loadTokenRingTexture } from '../../src/app/pixi/token-renderer/tokenRingTexture';
import { TokenVisualUI } from '../../src/app/pixi/token-renderer/TokenVisualUI';
import { ResourceBarView } from '../../src/app/pixi/token-renderer/resources/ResourceBarView';
import { DoorIcons, type DoorIconsStore } from '../../src/app/pixi/lighting/DoorIcons';
import { PlayerTokens } from '../src/canvas/PlayerTokens';
import { PlayerDoorBadges } from '../src/canvas/PlayerDoorBadges';
import type { SharedToken } from '../../src/app/online/protocol/tokens';
import type { GridSystem } from '../../src/app/grid/GridSystem';
import type { TokenEntity } from '../../src/app/types';
import type { VisibleResource } from '../../src/app/resources/resourceTypes';
import { DownedTokenOverlay } from '../../src/app/pixi/token-renderer/DownedTokenOverlay';
import { updateInstanceBadge } from '../../src/app/pixi/token-renderer/InstanceBadge';
import { PlayerLighting } from '../src/canvas/PlayerLighting.ts';
import { createPlayerStore } from '../src/state/playerStore.ts';
const artRef = { hash: 'a'.repeat(64), size: 100, mime: 'image/png' };
const token: SharedToken = {
  id: '111111111111111111111111', x: 96, y: 96, size: 62, cells: 1, rotation: 35,
  art: artRef, name: 'Alice', ring: { colour: '#aabbcc', size: 70 }, claim: 'taken', badge: null,
  ui: { nameplate: true, downed: false, bars: [
    { colour: '#22c55e', direction: 'drains', defeats: true, current: 5, max: 10 },
    { colour: '#6366f1', direction: 'fills', defeats: false, current: 2, max: 6 },
  ], conditions: [{ colour: '#663399', glyph: { kind: 'text', text: 'F' }, value: 2 }] },
};

let app: Application;
let texture: Texture;
let restoreHost: () => void;

beforeAll(async () => {
  restoreHost = installDomHost({
    createCanvas: (doc = document, size) => {
      const canvas = doc.createElement('canvas');
      if (size) { canvas.width = size.width; canvas.height = size.height; }
      return canvas;
    },
    createDiv: (parent, cls) => {
      const div = parent.ownerDocument.createElement('div');
      div.className = cls;
      parent.append(div);
      return div;
    },
    ownerWindow: (node) => node.ownerDocument!.defaultView!,
    activeDocument: () => document,
  });
  app = new Application();
  await app.init({ width: 256, height: 256, resolution: 1, preference: 'webgl', antialias: false, preserveDrawingBuffer: true, autoStart: false, backgroundAlpha: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#dd5522';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#2288dd';
  ctx.fillRect(0, 0, 32, 64);
  texture = new Texture({ source: new CanvasSource({ resource: canvas }) });
  await loadTokenRingTexture();
});

afterAll(() => {
  texture.destroy(true);
  app.destroy(true);
  restoreHost();
});

function pixels(view: Container): Uint8ClampedArray {
  app.renderer.render({ container: view, clear: true });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(app.canvas, 0, 0);
  return ctx.getImageData(0, 0, 256, 256).data;
}

describe('shared token visual cutover', () => {
  it.each([true, false])('matches plugin artwork, mask, rotation and ring for framed=%s', async (framed) => {
    const factory = new SpriteFactory({ getOptions: () => ({ size: 70 }) } as GridSystem);
    const plugin = await factory.createTokenSprite({ id: 'local', x: 96, y: 96, kind: 'character', size: 1, rotation: 35, showRing: framed, ringColor: '#aabbcc' } as TokenEntity, texture);
    const browser = new PlayerTokens({ acquire: async () => texture, release: vi.fn(), changed: vi.fn() });
    browser.update([{ ...token, ring: framed ? token.ring : null, ui: null }], { cellSize: 70, zoom: 1 });
    await Promise.resolve();
    expect(pixels(browser.view)).toEqual(pixels(plugin));
    const art = browser.view.children[0]!.getChildByLabel('tokenSprite') as Sprite;
    expect(!!art.mask).toBe(framed);
    if (!framed) expect(art.width / art.height).toBe(2);
    browser.destroy();
    factory.destroyTokenSprite(plugin);
    expect(texture.destroyed).toBe(false);
  });

  it('matches the plugin downed skull, grey art and instance badge', async () => {
    const factory = new SpriteFactory({ getOptions: () => ({ size: 70 }) } as GridSystem);
    const plugin = await factory.createTokenSprite({ id: 'local', x: 96, y: 96, kind: 'character', size: 1, rotation: 35, showRing: true, ringColor: '#aabbcc' } as TokenEntity, texture);
    const downed = new DownedTokenOverlay(vi.fn(), () => null);
    downed.update(plugin, true, false);
    updateInstanceBadge(plugin, 2, 62, true);
    const browser = new PlayerTokens({ acquire: async () => texture, release: vi.fn(), changed: vi.fn() });
    browser.update([{ ...token, badge: 2, ui: { nameplate: false, downed: true, bars: [], conditions: [] } }], { cellSize: 70, zoom: 1 });
    await Promise.resolve();
    expect(pixels(browser.view)).toEqual(pixels(plugin));
    browser.destroy();
    downed.destroy();
    factory.destroyTokenSprite(plugin);
  });

  it('shares warning bars for both sockets without browser resource definitions', () => {
    const plugin = new ResourceBarView(null);
    const browser = new ResourceBarView(null);
    for (const bar of token.ui!.bars) {
      plugin.update({ definition: { key: 'hp', name: 'HP', color: bar.colour, direction: bar.direction, defeatedWhenSpent: bar.defeats }, value: { current: bar.current, max: bar.max }, slot: 0 } as VisibleResource, 2, false);
      browser.updateVisual(bar, 2, false);
      plugin.setTextAlpha(1);
      browser.setTextAlpha(1);
      plugin.view.position.set(96, 96);
      browser.view.position.set(96, 96);
      expect(pixels(browser.view)).toEqual(pixels(plugin.view));
    }
    plugin.destroy();
    browser.destroy();
  });

  it('grows selected bars below zoom 2.25 but keeps held bars and condition badges at rest', () => {
    const ui = new TokenVisualUI();
    const layout = { cellSize: 70, zoom: 0.75, selected: true, held: false };
    ui.update(token, layout);
    expect(ui.view.children[0]?.scale.x).toBe(3);
    const condition = ui.view.children[1]?.children[0];
    expect(condition?.scale.x).toBe(1);
    expect(ui.view.children[0]?.children.filter((child) => child.zIndex === 10)).toHaveLength(2);
    ui.update(token, { ...layout, held: true });
    expect(ui.view.children[0]?.scale.x).toBe(1);
    ui.destroy();
  });

  it('takes the last listed visible token and hides all of a fog-covered dragged token', () => {
    const browser = new PlayerTokens({ acquire: async () => texture, release: vi.fn(), changed: vi.fn() });
    const second = { ...token, id: '222222222222222222222222' };
    browser.update([token, second], { cellSize: 70, zoom: 1 });
    expect(browser.hitTest(96, 96)).toBe(second.id);
    browser.update([token, second], { cellSize: 70, zoom: 1, held: new Set([second.id]), visible: ({ id }) => id === token.id });
    expect(browser.hitTest(96, 96)).toBe(token.id);
    expect(browser.view.children[1]?.visible).toBe(false);
    expect(browser.ui.children[1]?.visible).toBe(false);
    browser.destroy();
  });

  it('releases late artwork without resurrecting a withdrawn token', async () => {
    const pending = Promise.withResolvers<Texture>();
    const release = vi.fn();
    const browser = new PlayerTokens({ acquire: () => pending.promise, release, changed: vi.fn() });
    browser.update([token], { cellSize: 70, zoom: 1 });
    browser.update([], { cellSize: 70, zoom: 1 });
    pending.resolve(texture);
    await Promise.resolve();
    expect(browser.view.children).toHaveLength(0);
    expect(release).toHaveBeenCalledExactlyOnceWith(artRef);
    browser.destroy();
  });
});

describe('ordinary door badge parity and bounds', () => {
  it('matches plugin player badges, never toggles locally, and excludes draw-only or covered doors', () => {
    const toggleDoor = vi.fn();
    const store = createStore(() => ({ grid: { size: 70 }, lighting: {}, mapPath: 'scene', objects: { fog: {}, walls: {
      door: { id: 'door', kind: 'wall', type: 'door', p1: { x: 64, y: 96 }, p2: { x: 128, y: 96 }, closed: true },
    } }, toggleDoor }));
    const plugin = new DoorIcons(store as unknown as DoorIconsStore, app.canvas, () => new Set(['door']));
    plugin.playerView.visible = true;
    const request = vi.fn();
    const browser = new PlayerDoorBadges(app.canvas, request, vi.fn());
    const door = { id: token.id, p: [64, 96, 128, 96] as const, open: false };
    browser.update([door], 70);
    expect(pixels(browser.view)).toEqual(pixels(plugin.playerView));
    expect(browser.activate(110, 96)).toBe(true);
    expect(browser.activate(110.01, 96)).toBe(false);
    expect(request).toHaveBeenCalledExactlyOnceWith(token.id);
    expect(toggleDoor).not.toHaveBeenCalled();
    browser.update([{ p: door.p, open: true }], 70);
    expect(browser.hitTest(96, 96)).toBeNull();
    browser.update([door], 70, () => false);
    expect(browser.activate(96, 96)).toBe(false);
    browser.destroy();
    plugin.destroy();
  });

  it('uses the shared reduced-motion refusal tint and cancels its animation on teardown', () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const request = vi.fn();
    const browser = new PlayerDoorBadges(app.canvas, request, vi.fn());
    try {
      browser.update([{ id: token.id, p: [64, 96, 128, 96], open: false }], 70);
      browser.refuse(token.id);
      expect((browser.view.children[1] as Sprite).tint).toBe(0xff5d5d);
      expect(request).not.toHaveBeenCalled();
    } finally {
      browser.destroy();
      media.mockRestore();
    }
  });
});
describe('Canvas2D sight fallback', () => {
  it('keeps the map visible only inside player sight on the real Canvas renderer', async () => {
    const fallbackApp = new Application();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let lighting: PlayerLighting | null = null;
    try {
      await fallbackApp.init({ width: 128, height: 128, preference: 'canvas', backgroundAlpha: 0 });
      expect(fallbackApp.renderer.name).toBe('canvas');
      const player = createPlayerStore();
      player.getState().beginScene({ id: 'fallback', lit: true, personal: true, memoryId: 'a'.repeat(24), map: null });
      player.getState().applySceneMessage({ t: 'lighting', scene: 'fallback', cellSize: 64, unitDistance: 5, walls: [], zones: [], senses: [] });
      player.getState().applySceneMessage({
        t: 'sight', scene: 'fallback', lighting: { ambient: 1 }, lights: [],
        tokens: [{ id: 'b'.repeat(24), x: 64, y: 64, size: 20, vision: { senses: [], sightRange: 1 } }], held: [],
      });
      const memory = { get: async () => null, writeEpoch: () => 0, put: async () => undefined, deleteFor: async () => undefined };
      lighting = new PlayerLighting(fallbackApp.renderer, memory, () => undefined, () => undefined);
      const floor = new Sprite(Texture.WHITE);
      floor.width = 128;
      floor.height = 128;
      floor.tint = 0x00aa55;
      fallbackApp.stage.addChild(floor, lighting.container);
      expect(lighting.update(player.getState().scene!, 128, 128, Texture.WHITE, 'table', 'alice')).toBe(true);
      fallbackApp.renderer.render({ container: fallbackApp.stage });
      const context = new OffscreenCanvas(128, 128).getContext('2d')!;
      context.drawImage(fallbackApp.canvas, 0, 0, 128, 128);
      const pixels = context.getImageData(0, 0, 128, 128).data;
      const centerOffset = (64 * 128 + 64) * 4;
      const outsideOffset = (8 * 128 + 8) * 4;
      expect(pixels[centerOffset + 1]).toBeGreaterThan(pixels[centerOffset] ?? Infinity);
      expect(pixels[outsideOffset]! + pixels[outsideOffset + 1]! + pixels[outsideOffset + 2]!).toBeLessThan(pixels[centerOffset]! + pixels[centerOffset + 1]! + pixels[centerOffset + 2]!);
      expect(errors).toHaveBeenCalled();
    } finally {
      lighting?.destroy();
      if (fallbackApp.renderer) fallbackApp.destroy(true);
      errors.mockRestore();
    }
  });
});
