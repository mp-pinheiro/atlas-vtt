import { Container, Graphics, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import { DrawingLayer } from '../../../src/app/pixi/drawingLayer.ts';
import { createTextElementView } from '../../../src/app/pixi/textElementView.ts';
import { createPinIconTexture } from '../../../src/app/pixi/utils/pinIconTexture.ts';
import { resolvePinIcon, PIN_ICON_PATHS, type PinIconId } from '../../../src/app/types/pinIcons.ts';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree.ts';
import { RemoteLasers } from '../../../src/app/online/marks/RemoteLasers.ts';
import { RemoteMeasures, type MeasureRules } from '../../../src/app/online/marks/RemoteMeasures.ts';
import { RemoteCursors, type CursorCamera } from '../../../src/app/online/marks/RemoteCursors.ts';
import type { MarksMessage } from '../../../src/app/online/protocol/marks.ts';
import type { DrawingStroke, TextElement } from '../../../src/app/types.ts';
import type { SharedAnnotations, SharedPin } from '../../../src/app/online/protocol/mapLayers.ts';
import type { TablePerson } from '../../../src/app/online/protocol/chat.ts';
import { canvasBadgeColors } from '../../../src/app/pixi/utils/canvasBadgeColors.ts';

export class PlayerLayers {
  readonly annotations = new Container();
  readonly pins = new Container();
  readonly marks = new Container();
  readonly proposals = new Graphics();
  private readonly drawings = new Container();
  private readonly texts = new Container();
  private readonly drawingLayer = new DrawingLayer(this.drawings);
  private readonly textures = new Map<string, Texture>();
  private readonly lasers: RemoteLasers;
  private readonly measures: RemoteMeasures;
  private readonly cursors: RemoteCursors;
  private lastAnnotations: SharedAnnotations | null = null;
  private lastPins: readonly SharedPin[] | null = null;
  private zoom = 1;
  private colours: Readonly<Record<string, number | undefined>> = {};
  private pinList: readonly SharedPin[] = [];
  constructor(renderer: Renderer, cursorHost: HTMLElement, zoom: () => number, rules: () => MeasureRules | null) {
    this.annotations.addChild(this.drawings, this.texts);
    this.lasers = new RemoteLasers(renderer, zoom, 100);
    this.measures = new RemoteMeasures(zoom, rules, 100);
    this.cursors = new RemoteCursors(cursorHost, (cursor) => cursor.name ?? '', 100, (who) => this.colours[who]);
    this.marks.addChild(this.lasers.container, this.measures.container);
  }
  update(annotations: SharedAnnotations | null, pins: readonly SharedPin[] | null, zoom: number, visible: (point: { x: number; y: number }) => boolean): void {
    if (annotations !== this.lastAnnotations) {
      this.lastAnnotations = annotations;
      this.drawingLayer.sync(Object.fromEntries((annotations?.drawings ?? []).map((drawing, index) => [String(index), { id: String(index), kind: 'drawing', type: drawing.type, points: Array.from({ length: drawing.points.length / 2 }, (_, i) => ({ x: drawing.points[i * 2]!, y: drawing.points[i * 2 + 1]! })), color: drawing.colour, width: drawing.width, opacity: drawing.opacity, icon: drawing.icon } as DrawingStroke])));
      for (const child of this.texts.removeChildren()) destroyTree(child);
      for (const [index, text] of (annotations?.texts ?? []).entries()) this.texts.addChild(createTextElementView({ ...text, id: String(index), kind: 'text', color: text.colour, backgroundColor: text.background ?? undefined, borderRadius: text.radius } as TextElement));
    }
    if (pins === this.lastPins && zoom === this.zoom) {
      this.pinList.forEach((pin, index) => { const child = this.pins.children[index]; if (child) child.visible = visible(pin); });
      return;
    }
    this.lastPins = pins; this.zoom = zoom; this.pinList = pins ?? [];
    for (const child of this.pins.removeChildren()) destroyTree(child);
    for (const pin of this.pinList) {
      const view = new Container({ x: pin.x, y: pin.y });
      view.scale.set(1 / zoom); view.visible = visible(pin);
      const colors = canvasBadgeColors();
      const badge = new Graphics().circle(0, 0, 15).fill(colors.background).stroke({ color: colors.stroke, width: 1 });
      view.addChild(badge);
      const icon = resolvePinIcon(pin.icon);
      let texture = this.textures.get(icon);
      if (!texture && icon in PIN_ICON_PATHS) { texture = createPinIconTexture(icon as PinIconId) ?? undefined; if (texture) this.textures.set(icon, texture); }
      if (texture) { const sprite = new Sprite(texture); sprite.anchor.set(0.5); sprite.width = 22; sprite.height = 22; view.addChild(sprite); }
      if (pin.label) { const label = new Text({ text: pin.label, style: { fontSize: 10, fill: 0xffffff } }); label.anchor.set(0.5); label.y = 20; view.addChild(label); }
      this.pins.addChild(view);
    }
  }
  hitPin(x: number, y: number): SharedPin | null { return this.pinList.find((pin, index) => this.pins.children[index]?.visible && Math.hypot(pin.x - x, pin.y - y) <= 18 / this.zoom) ?? null; }
  setPeople(people: readonly TablePerson[]): void { this.colours = Object.fromEntries(people.map((person) => [person.id, person.colour])); }
  receiveMarks(message: MarksMessage, now: number): void { this.lasers.update(message.lasers, now); this.measures.update(message.measures, now); this.cursors.update(message.cursors ?? [], now); }
  tick(now: number, camera: CursorCamera): void { this.lasers.tick(now); this.measures.tick(now); this.cursors.tick(now, camera, devicePixelRatio, false); }
  reset(): void { this.receiveMarks({ t: 'marks', scene: '', lasers: [], measures: [], cursors: [] }, performance.now()); this.proposals.clear(); }
  destroy(): void { this.drawingLayer.destroy(); this.lasers.destroy(); this.measures.destroy(); this.cursors.clear(); for (const texture of this.textures.values()) texture.destroy(true); destroyTree(this.annotations); destroyTree(this.pins); destroyTree(this.marks); destroyTree(this.proposals); }
}
