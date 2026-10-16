import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Container } from 'pixi.js';
import { installDomHost, type DomHost } from '../../../src/app/host/dom';
import { SpriteFactory } from '../../../src/app/pixi/token-renderer/SpriteFactory';
import { getConditionGlyphTexture } from '../../../src/app/pixi/token-renderer/conditionGlyphTexture';
import { createDownedEmblemTexture } from '../../../src/app/pixi/token-renderer/downedEmblemTexture';
import { stubJsdomGraphics } from '../../mocks/jsdomGraphics';

/**
 * The token textures are drawn in the players' browser as well as in Obsidian, where `createEl` does not
 * exist, so every canvas they paint on comes from the DOM host. A regression to the global would draw on a
 * canvas of Obsidian's and break the browser client.
 */
let canvases: HTMLCanvasElement[];
let hostCanvas: (canvas: HTMLCanvasElement) => void;
let createCanvas: Mock<DomHost['createCanvas']>;
let restoreHost: () => void;
let restoreGraphics: () => void;

beforeEach(() => {
  restoreGraphics = stubJsdomGraphics();
  canvases = [];
  hostCanvas = () => undefined;
  createCanvas = vi.fn<DomHost['createCanvas']>(() => {
    const canvas = document.createElement('canvas');
    hostCanvas(canvas);
    canvases.push(canvas);
    return canvas;
  });
  restoreHost = installDomHost({
    createCanvas,
    createDiv: (parent, cls) => parent.createDiv({ cls }),
    ownerWindow: (node) => node.ownerDocument?.defaultView ?? window,
    activeDocument: () => document,
  });
});

afterEach(() => {
  restoreHost();
  restoreGraphics();
  vi.restoreAllMocks();
});

/** A host whose canvases offer no 2D context, as a browser without canvas support would give. */
function withoutContext(): void {
  hostCanvas = (canvas) => { Object.defineProperty(canvas, 'getContext', { value: (): null => null }); };
}

function sizeOf(canvas: HTMLCanvasElement | undefined): [number, number] | undefined {
  return canvas && [canvas.width, canvas.height];
}

describe('the canvases of the token textures', () => {
  it('draws a condition glyph on a canvas of the host', () => {
    const create = vi.spyOn(globalThis, 'createEl');
    const texture = getConditionGlyphTexture({ kind: 'text', text: 'Q' });
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(texture?.source.resource).toBe(canvases[0]);
    expect(create).not.toHaveBeenCalledWith('canvas');
  });

  it('gives no glyph where the host canvas has no 2D context, and keeps nothing of it', () => {
    withoutContext();
    expect(getConditionGlyphTexture({ kind: 'text', text: 'W' })).toBeNull();
    expect(createCanvas).toHaveBeenCalledOnce();
    hostCanvas = () => undefined;
    expect(getConditionGlyphTexture({ kind: 'text', text: 'W' })?.source.resource).toBe(canvases[1]);
  });

  it('rasterises the downed emblem on a canvas of the host, at the size asked for', () => {
    const create = vi.spyOn(globalThis, 'createEl');
    const texture = createDownedEmblemTexture(96);
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(texture.source.resource).toBe(canvases[0]);
    expect(sizeOf(canvases[0])).toEqual([96, 96]);
    expect(create).not.toHaveBeenCalledWith('canvas');
  });

  it('refuses the downed emblem where the host canvas has no 2D context', () => {
    withoutContext();
    expect(() => createDownedEmblemTexture(96)).toThrow('Could not acquire 2D context');
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  it('paints the glass dome of a token on a canvas of the host, once for every token', () => {
    const create = vi.spyOn(globalThis, 'createEl');
    const factory = new SpriteFactory({ getOptions: () => ({ size: 70, type: 'square' }) } as never);
    const first = factory.createGlassOverlay(new Container(), 70);
    const second = factory.createGlassOverlay(new Container(), 70);
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(first.texture.source.resource).toBe(canvases[0]);
    expect(second.texture).toBe(first.texture);
    expect(sizeOf(canvases[0])).toEqual([512, 512]);
    expect(create).not.toHaveBeenCalledWith('canvas');
  });
});
