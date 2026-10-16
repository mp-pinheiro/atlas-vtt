import { Circle, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { destroyTree } from '../utils/destroyTree';
import { getTokenRingOuterDiameter } from './tokenRingMetrics';
import { NAMEPLATE_HEIGHT } from './tokenSizing';
import { tokenGlassTexture } from './tokenGlassTexture';

export interface TokenArtworkView<TokenData extends { showRing?: boolean } = { showRing?: boolean }> extends Container {
  tokenSize: number;
  strokeWidth: number;
  tokenData: TokenData;
}

export class TokenVisual {
  static create(texture: Texture, size: number): Container {
    const view = new Container({ label: 'tokenGroup', sortableChildren: true, eventMode: 'passive' });
    const background = new Graphics({ label: 'tokenBackground', eventMode: 'none' });
    background.circle(0, 0, size / 2).fill({ color: 0, alpha: 0 });
    background.zIndex = -10;
    const mask = new Graphics({ label: 'tokenArtMask', eventMode: 'none' });
    mask.circle(0, 0, size / 2).fill(0xffffff);
    const sprite = new Sprite({ texture, anchor: 0.5, label: 'tokenSprite', eventMode: 'none' });
    sprite.setSize(size);
    sprite.mask = mask;
    view.addChild(background, mask, sprite);
    TokenVisual.glass(view, size);
    return view;
  }

  static resize(view: TokenArtworkView, size: number, strokeWidth: number): void {
    view.tokenSize = size;
    view.strokeWidth = strokeWidth;
    const background = view.getChildByLabel('tokenBackground') as Graphics | null;
    if (background) {
      background.clear().circle(0, 0, size / 2).fill({ color: 0, alpha: 0 });
      background.hitArea = new Circle(0, 0, size / 2);
    }
    const glass = view.getChildByLabel('glassOverlay') as Sprite | null;
    if (glass) glass.setSize(size);
    TokenVisual.artwork(view, size, view.tokenData.showRing !== false);
  }

  static artwork(view: Container, size: number, framed: boolean): void {
    const sprite = view.getChildByLabel('tokenSprite') as Sprite | null;
    if (!sprite) return;
    const mask = view.getChildByLabel('tokenArtMask') as Graphics | null;
    if (mask) {
      mask.clear().circle(0, 0, size / 2).fill(0xffffff);
      sprite.mask = framed ? mask : null;
      mask.visible = framed;
    }
    const glass = view.getChildByLabel('glassOverlay');
    if (glass) glass.visible = framed;
    const width = sprite.texture.width || 1;
    const height = sprite.texture.height || 1;
    sprite.width = framed ? size : size * width / Math.max(width, height);
    sprite.height = framed ? size : size * height / Math.max(width, height);
  }

  static rotation(view: Container, degrees: number): void {
    const sprite = view.getChildByLabel('tokenSprite') as Sprite | null;
    if (sprite) sprite.rotation = degrees * Math.PI / 180;
  }

  static ring(view: TokenArtworkView, colour: string | null, texture: Texture | null, override?: number, outerDiameter?: number): Sprite | Graphics | null {
    for (let i = view.children.length - 1; i >= 0; i--) {
      const child = view.children[i];
      if (child && (child.label === 'tokenRing' || child.label === 'tokenRingShadow')) destroyTree(child);
    }
    TokenVisual.artwork(view, view.tokenSize, view.tokenData.showRing !== false);
    if (!colour || view.tokenData.showRing === false) return null;
    const size = override !== undefined && Number.isFinite(override) && override > 0 ? override : view.tokenSize;
    const ringSize = outerDiameter ?? getTokenRingOuterDiameter(size, view.strokeWidth, size / view.tokenSize);
    const parsed = Number.parseInt(colour.replace('#', ''), 16);
    const tint = Number.isFinite(parsed) ? parsed : 0xffffff;
    if (texture && texture !== Texture.EMPTY) {
      const ring = new Sprite({ texture, anchor: 0.5, tint, label: 'tokenRing', eventMode: 'none' });
      ring.setSize(ringSize);
      ring.zIndex = 2;
      return view.addChild(ring);
    }
    const ring = new Graphics({ label: 'tokenRing', eventMode: 'none' });
    const width = Math.max(2, (ringSize - size) / 2);
    ring.circle(0, 0, Math.max(0, ringSize / 2 - width / 2)).stroke({ width, color: tint, alpha: 0.95, alignment: 0.5 });
    ring.zIndex = 2;
    return view.addChild(ring);
  }

  static glass(view: Container, size: number): Sprite {
    const glass = new Sprite({ texture: tokenGlassTexture(), anchor: 0.5, label: 'glassOverlay', eventMode: 'none' });
    glass.setSize(size);
    glass.zIndex = 1;
    return view.addChild(glass);
  }

  static nameplate(badge: Graphics, text: Text, name: string, dark: boolean): void {
    badge.clear();
    text.text = name;
    text.alpha = 0.85;
    text.anchor.set(0.5);
    text.scale.set(0.333);
    const width = Math.max(text.getLocalBounds().width * 0.333 + 12, 40);
    const height = NAMEPLATE_HEIGHT;
    badge.roundRect(-width / 2, -height, width, height, height / 2).fill({ color: dark ? 0x2a2a2a : 0xe3e3e3 });
    badge.roundRect(-width / 2, -height, width, height, height / 2).stroke({ width: 0.5, color: dark ? 0xffffff : 0, alpha: dark ? 0.4 : 0.3 });
    text.position.set(0, -height / 2);
  }
}
