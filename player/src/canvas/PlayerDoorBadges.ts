import { Container } from 'pixi.js';
import type { SharedDoor } from '../../../src/app/online/protocol/mapLayers';
import { createDoorBadgeSet, DoorBadgeRenderer, DoorRefusal, doorBadgeAt, type DoorBadgeSpec } from '../../../src/app/pixi/lighting/DoorBadge';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree';

export class PlayerDoorBadges {
  readonly view = new Container({ label: 'player-door-icons', zIndex: 1150 });
  private readonly badges = createDoorBadgeSet(this.view);
  private readonly renderer = new DoorBadgeRenderer();
  private readonly refusal: DoorRefusal;
  private shown: DoorBadgeSpec[] = [];
  private actionable: DoorBadgeSpec[] = [];
  private radius = 14;
  private stopped = false;

  constructor(canvas: HTMLCanvasElement, private readonly request: (alias: string) => void, private readonly changed: () => void) {
    this.refusal = new DoorRefusal(canvas, () => this.draw());
  }

  update(doors: readonly SharedDoor[], cellSize: number, visible: (door: SharedDoor) => boolean = () => true): void {
    if (this.stopped) return;
    this.radius = cellSize * 0.2;
    this.shown = [];
    this.actionable = [];
    doors.forEach((door, index) => {
      if (!visible(door)) return;
      const badge = { id: door.id ?? `draw-only:${index}`, x: (door.p[0] + door.p[2]) / 2, y: (door.p[1] + door.p[3]) / 2, open: door.open };
      this.shown.push(badge);
      if (door.id) this.actionable.push(badge);
    });
    this.draw();
  }

  hitTest(x: number, y: number): string | null {
    return !this.stopped && this.view.visible ? doorBadgeAt(this.actionable, this.radius, x, y) : null;
  }

  activate(x: number, y: number): boolean {
    const id = this.hitTest(x, y);
    if (!id) return false;
    this.request(id);
    return true;
  }

  refuse(alias: string): void {
    if (!this.stopped && this.view.visible && this.actionable.some(({ id }) => id === alias)) this.refusal.start(alias);
  }

  private draw(): void {
    if (this.stopped) return;
    this.renderer.draw(this.badges, this.shown, this.radius, this.refusal.look(this.radius));
    this.changed();
  }

  destroy(): void {
    this.stopped = true;
    this.refusal.cancel();
    this.shown = [];
    this.actionable = [];
    destroyTree(this.view);
    this.renderer.destroy();
  }
}
