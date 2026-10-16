import { Container, Graphics } from 'pixi.js';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { fogCoverage } from '../../../src/app/fog/fogCoverage';
import { setLayerVisibility } from '../../../src/app/pixi/playerSafeFrame';
import { PlayerSightTokens, type SightedSprite } from '../../../src/app/pixi/token-renderer/PlayerSightTokens';
import type { TokenGroupContainer } from '../../../src/app/pixi/token-renderer/spriteTypes';
import type { TokenEntity } from '../../../src/app/types';
import type { TokenPerception } from '../../../src/app/vision/tokenPerception';
import { fogRectangle } from '../../helpers/fogOperations';

/** The players' browser client draws tokens that are not PIXI containers: a sprite is a place, a size and whether it shows. */
const sprite = (x: number, y: number, changes: Partial<SightedSprite> = {}): SightedSprite => ({ visible: true, x, y, ...changes });

const token = (id: string, x: number, y: number, changes: Partial<TokenEntity> = {}): TokenEntity =>
  ({ id, kind: 'token', imagePath: '', x, y, ...changes }) as TokenEntity;

const sights: PlayerSightTokens[] = [];
afterEach(() => sights.splice(0).forEach((sight) => sight.destroy()));

function sightOf(
  tokens: Record<string, TokenEntity>,
  sprites: Record<string, SightedSprite | null>,
  held: readonly string[] = [],
): PlayerSightTokens {
  const sight = new PlayerSightTokens({ tokens: () => tokens, sprites: () => sprites, held: () => new Set(held) });
  sights.push(sight);
  return sight;
}

const answering = (answers: Record<string, 'seen' | 'sensed' | 'unseen'>): TokenPerception => (id) => answers[id] ?? 'seen';

/** The outlines drawn in a layer of the sensed outlines, by the place each stands in and how wide it is. */
function drawn(layer: Container): { x: number; y: number; width: number }[] {
  return layer.children.filter((child) => child instanceof Graphics).map((child) => ({ x: child.x, y: child.y, width: child.getLocalBounds().width }));
}

/** The layer a players' frame alone shows: the outlines of tokens the pointer holds. */
const heldLayerOf = (sight: PlayerSightTokens): Container => sight.outlineLayer.children.find((child) => !(child instanceof Graphics)) as Container;

describe('PlayerSightTokens with plain-object sprites', () => {
  it('leaves out the sprites of tokens the players do not see, and only those', () => {
    const tokens = { a: token('a', 0, 0), b: token('b', 50, 0), c: token('c', 100, 0), gone: token('gone', 150, 0, { isHidden: true }) };
    const sprites = { a: sprite(0, 0), b: sprite(50, 0), c: sprite(100, 0), gone: sprite(150, 0) };
    const sight = sightOf(tokens, sprites);

    const layers = sight.frameLayers(answering({ b: 'unseen', c: 'sensed' }));
    const hidden = layers.filter(({ visible }) => !visible).map(({ layer }) => layer);
    expect(hidden).toEqual(expect.arrayContaining([sprites.b, sprites.c, sprites.gone]));
    expect(hidden).not.toContain(sprites.a);
    expect(hidden).toHaveLength(3);

    setLayerVisibility(layers);
    expect([sprites.a.visible, sprites.b.visible, sprites.c.visible, sprites.gone.visible]).toEqual([true, false, false, false]);
  });

  it('skips a token whose sprite is not drawn', () => {
    const tokens = { a: token('a', 0, 0), b: token('b', 50, 0) };
    const sight = sightOf(tokens, { a: sprite(0, 0), b: null });
    const hidden = sight.frameLayers(answering({ a: 'unseen', b: 'unseen' })).filter(({ visible }) => !visible);
    expect(hidden).toHaveLength(1);
  });

  it('outlines a sensed token where its sprite stands, as large as the sprite says, and 70 without a size', () => {
    const tokens = { big: token('big', 0, 0), plain: token('plain', 0, 0) };
    const sight = sightOf(tokens, { big: sprite(210, 140, { tokenSize: 140 }), plain: sprite(35, 70) });

    sight.syncOutlines(answering({ big: 'sensed', plain: 'sensed' }));
    const [big, plain] = drawn(sight.outlineLayer);
    expect([big?.x, big?.y]).toEqual([210, 140]);
    expect([plain?.x, plain?.y]).toEqual([35, 70]);
    expect(big!.width).toBeGreaterThan(plain!.width * 1.8);
    expect(big!.width).toBeLessThan(plain!.width * 2.2);
  });

  it('follows a sprite that moved, one outline at a time', () => {
    const moving = sprite(10, 10, { tokenSize: 70 });
    const sight = sightOf({ t: token('t', 10, 10) }, { t: moving });
    const sensed = answering({ t: 'sensed' });
    sight.syncOutlines(sensed);
    expect(drawn(sight.outlineLayer).map(({ x, y }) => [x, y])).toEqual([[10, 10]]);

    moving.x = 300;
    sight.syncOutline('t', sensed);
    expect(drawn(sight.outlineLayer).map(({ x, y }) => [x, y])).toEqual([[300, 10]]);

    sight.syncOutline('t', answering({ t: 'seen' }));
    expect(drawn(sight.outlineLayer)).toEqual([]);
  });

  it('outlines no hidden token, no token that is seen or unseen, and none without a sprite', () => {
    const tokens = { hidden: token('hidden', 0, 0, { isHidden: true }), seen: token('seen', 0, 0), unseen: token('unseen', 0, 0), bare: token('bare', 0, 0) };
    const sprites = { hidden: sprite(0, 0), seen: sprite(0, 0), unseen: sprite(0, 0), bare: null };
    const sight = sightOf(tokens, sprites);
    sight.syncOutlines(answering({ hidden: 'sensed', seen: 'seen', unseen: 'unseen', bare: 'sensed' }));
    expect(drawn(sight.outlineLayer)).toEqual([]);
    expect(drawn(heldLayerOf(sight))).toEqual([]);
  });

  it('keeps the outline of a held token in the layer only a players\' frame shows', () => {
    const tokens = { t: token('t', 0, 0) };
    const sight = sightOf(tokens, { t: sprite(5, 5) }, ['t']);
    const layers = sight.frameLayers(answering({ t: 'sensed' }));
    const held = heldLayerOf(sight);
    expect(drawn(held).map(({ x, y }) => [x, y])).toEqual([[5, 5]]);
    expect(layers.at(-1)).toEqual({ layer: held, visible: true });
    expect(drawn(sight.outlineLayer)).toEqual([]);
  });

  it('tests fog at the centre the sprite is drawn at, not at the token\'s stored place', () => {
    const tokens = { t: token('t', 10, 10) };
    const fog = fogCoverage({ paint: fogRectangle({ x: 0, y: 0, width: 40, height: 40 }) });
    const moving = sprite(10, 10);
    const sight = sightOf(tokens, { t: moving });
    sight.setFogProvider(() => fog, () => true);

    expect(sight.hides('t')).toBe(true);
    expect(sight.framePerception()?.('t')).toBe('unseen');
    moving.x = 200;
    moving.y = 200;
    expect(sight.hides('t')).toBe(false);
    expect(sight.framePerception()?.('t')).toBe('seen');
  });

  it('falls back to the token\'s own place before it has a sprite, and fails closed without fog coverage', () => {
    const tokens = { t: token('t', 10, 10) };
    const fog = fogCoverage({ paint: fogRectangle({ x: 0, y: 0, width: 40, height: 40 }) });
    let coverage: ReturnType<typeof fogCoverage> | null = fog;
    const sight = sightOf(tokens, { t: null });
    sight.setFogProvider(() => coverage, () => true);

    expect(sight.hides('t')).toBe(true);
    coverage = null;
    expect(sight.framePerception()?.('t')).toBe('unseen');
  });

  it('does not hide a held token that lighting alone hides', () => {
    const tokens = { t: token('t', 0, 0) };
    const sight = sightOf(tokens, { t: sprite(0, 0) }, ['t']);
    const unseen = answering({ t: 'unseen' });
    expect(sight.hides('t', unseen)).toBe(false);
    expect(sightOf(tokens, { t: sprite(0, 0) }).hides('t', unseen)).toBe(true);
  });

  it('takes the plugin\'s token group as a sprite, and anything with a place that shows or not', () => {
    expectTypeOf<TokenGroupContainer>().toExtend<SightedSprite>();
    expectTypeOf<{ visible: boolean; x: number; y: number }>().toExtend<SightedSprite>();
    expectTypeOf<{ visible: boolean; x: number }>().not.toExtend<SightedSprite>();
  });
});
