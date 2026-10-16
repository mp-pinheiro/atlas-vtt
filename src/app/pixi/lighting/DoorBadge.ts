import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { DOOR_GLYPH_PATHS, type DoorGlyph } from '../../lighting/doorGlyphs';
import { MOTION_SLOW_MS, prefersReducedMotion } from '../../utils/motion';
import { destroyTree } from '../utils/destroyTree';
import { createGlyphTexture } from '../utils/pinIconTexture';
import { ValueTransition } from '../utils/ValueTransition';

export interface DoorBadgeSpec {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
  readonly secret?: boolean;
  readonly lock?: boolean;
}

export interface DoorBadgeSet {
  readonly view: Container;
  readonly graphics: Graphics;
  readonly glyphs: Map<string, Sprite>;
}

export interface DoorRefusalLook {
  readonly doorId: string;
  readonly offset: number;
  readonly tint: boolean;
}

export function createDoorBadgeSet(view: Container): DoorBadgeSet {
  view.eventMode = 'none';
  return { view, graphics: view.addChild(new Graphics()), glyphs: new Map() };
}

export class DoorRefusal {
  private refused: { id: string; reduced: boolean } | null = null;
  private readonly transition = new ValueTransition(0, MOTION_SLOW_MS, () => this.changed());

  constructor(private readonly canvas: HTMLCanvasElement, private readonly changed: () => void) {}

  start(id: string): void {
    this.refused = { id, reduced: prefersReducedMotion(this.canvas.ownerDocument.body) };
    this.transition.jumpTo(0);
    this.transition.animateTo(1, () => {
      this.refused = null;
      this.changed();
    });
  }

  look(radius: number): DoorRefusalLook | null {
    if (!this.refused) return null;
    const progress = this.transition.value;
    return {
      doorId: this.refused.id,
      offset: this.refused.reduced ? 0 : Math.sin(progress * Math.PI * 4) * (1 - progress) * radius * 0.35,
      tint: this.refused.reduced,
    };
  }

  cancel(): void {
    this.transition.cancel();
    this.refused = null;
  }
}

export class DoorBadgeRenderer {
  private readonly textures = new Map<DoorGlyph, Texture | null>();

  draw(badges: DoorBadgeSet, doors: readonly DoorBadgeSpec[], radius: number, refusal: DoorRefusalLook | null): void {
    const { view, graphics: g, glyphs } = badges;
    g.clear();
    const withGlyph = new Set<string>();
    for (const door of doors) {
      const refusing = refusal?.doorId === door.id ? refusal : null;
      const x = door.x + (refusing?.offset ?? 0);
      const y = door.y;
      const color = refusing?.tint ? 0xff5d5d : door.secret ? 0xff8844 : 0x44aaff;
      g.circle(x, y, radius).fill({ color: 0x1b1b1f, alpha: 0.85 }).stroke({ width: radius * 0.14, color });
      if (door.lock) {
        drawLock(g, x, y, radius, color);
        continue;
      }
      const kind = door.open ? 'open' : 'closed';
      if (!this.textures.has(kind)) this.textures.set(kind, createGlyphTexture(DOOR_GLYPH_PATHS[kind], 256));
      const texture = this.textures.get(kind);
      if (!texture) continue;
      let glyph = glyphs.get(door.id);
      if (!glyph) {
        glyph = view.addChild(new Sprite({ anchor: { x: 0.5, y: 0.53 }, eventMode: 'none' }));
        glyphs.set(door.id, glyph);
      }
      withGlyph.add(door.id);
      glyph.texture = texture;
      glyph.position.set(x, y);
      glyph.setSize(radius * 1.35);
      glyph.tint = color;
    }
    for (const [id, glyph] of glyphs) {
      if (withGlyph.has(id)) continue;
      destroyTree(glyph);
      glyphs.delete(id);
    }
  }

  destroy(): void {
    for (const texture of this.textures.values()) if (texture && !texture.destroyed) texture.destroy(true);
    this.textures.clear();
  }
}

export function doorBadgeAt(doors: readonly DoorBadgeSpec[], radius: number, x: number, y: number): string | null {
  for (const door of doors) if (Math.hypot(x - door.x, y - door.y) <= radius) return door.id;
  return null;
}

function drawLock(g: Graphics, x: number, y: number, r: number, color: number): void {
  const top = y - r * 0.17;
  g.moveTo(x - r * 0.28, top).arc(x, top, r * 0.28, Math.PI, 0).stroke({ width: r * 0.14, color });
  g.roundRect(x - r * 0.45, top, r * 0.9, r * 0.62, r * 0.12).fill({ color });
  g.circle(x, top + r * 0.62 * 0.5, r * 0.1).fill({ color: 0x1b1b1f });
}
