import { describe, expect, it, vi } from 'vitest';
import 'pixi.js/events';
import { Circle, Container, EventBoundary, Texture } from 'pixi.js';
import { SpriteFactory } from '../../src/app/pixi/token-renderer/SpriteFactory';
vi.mock('../../src/app/pixi/token-renderer/tokenRingTexture', () => ({ loadedTokenRingTexture: () => Texture.EMPTY }));
vi.mock('../../src/app/pixi/token-renderer/tokenGlassTexture', () => ({ tokenGlassTexture: () => Texture.EMPTY }));

/**
 * Resize/rotation handles are added as children of the token group. PIXI prunes
 * a `passive` container with `interactiveChildren=false` from hit-testing
 * entirely, which would make those handles unclickable.
 */
describe('token group handle hit-testing', () => {
  it('lets a static child handle receive the hit', async () => {
    const gridSystem = { getOptions: () => ({ size: 70, type: 'square' }) } as any;
    const factory = new SpriteFactory(gridSystem, false);

    const token = { id: 't1', type: 'token', x: 0, y: 0, size: 1 } as any;
    const group = await factory.createTokenSprite(token, Texture.WHITE);

    const handle = new Container();
    handle.eventMode = 'static';
    handle.hitArea = new Circle(0, 0, 10);
    group.addChild(handle);

    const root = new Container();
    root.eventMode = 'static';
    root.addChild(group);

    expect(new EventBoundary(root).hitTest(0, 0)).toBe(handle);
  });
});
