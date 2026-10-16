import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import { destroyTree } from '../../../pixi/utils/destroyTree';
import type { PendingPaths, PendingPath, PathPoint } from '../PendingPaths';

export interface PathOverlayPorts {
  readonly window: Window;
  worldPoint(event: PointerEvent): PathPoint;
  zoom(): number;
  colour(path: PendingPath): number;
  gesture(active: boolean): void;
  requestRender(): void;
}
export class PendingPathOverlay {
  readonly layer = new Container();
  private readonly drawing = this.layer.addChild(new Graphics());
  private readonly unsubscribe: () => void;
  private dragging: { readonly request: string; readonly index: number; readonly pointer: number } | null = null;
  private selected: { readonly request: string; readonly index: number } | null = null;
  constructor(private readonly paths: Pick<PendingPaths, 'subscribe' | 'getSnapshot' | 'editingRequest' | 'endEdit' | 'editPoint' | 'insertPoint' | 'deletePoint'>, private readonly ports: PathOverlayPorts) {
    this.layer.label = 'atlas-gm-pending-paths';
    this.drawing.eventMode = 'static';
    this.drawing.on('pointerdown', this.down);
    this.unsubscribe = paths.subscribe(() => this.refresh());
    ports.window.addEventListener('pointermove', this.move, true);
    ports.window.addEventListener('pointerup', this.up, true);
    ports.window.addEventListener('pointercancel', this.cancel, true);
    ports.window.addEventListener('blur', this.cancel);
    ports.window.addEventListener('keydown', this.key, true);
    this.refresh();
  }
  refresh(): void {
    this.drawing.clear();
    const zoom = Math.max(this.ports.zoom(), 0.001);
    const editing = this.paths.editingRequest;
    for (const path of this.paths.getSnapshot()) {
      const colour = this.ports.colour(path);
      this.drawing.moveTo(path.start.x, path.start.y);
      for (const point of path.points) this.drawing.lineTo(point.x, point.y);
      this.drawing.stroke({ color: colour, width: (editing === path.request ? 4 : 2) / zoom, alpha: 0.85 });
      for (let i = 0; i < path.points.length; i++) {
        const point = path.points[i];
        if (point === undefined) continue;
        const selected = this.selected?.request === path.request && this.selected.index === i;
        this.drawing.circle(point.x, point.y, (selected ? 7 : 5) / zoom).fill({ color: colour }).stroke({ color: 0x111111, width: 1 / zoom });
      }
    }
    if (this.dragging !== null && (editing !== this.dragging.request || !this.paths.getSnapshot().some(p => p.request === this.dragging?.request))) this.release();
    this.ports.requestRender();
  }
  destroy(): void {
    this.release();
    this.paths.endEdit(false);
    this.unsubscribe();
    this.ports.window.removeEventListener('pointermove', this.move, true);
    this.ports.window.removeEventListener('pointerup', this.up, true);
    this.ports.window.removeEventListener('pointercancel', this.cancel, true);
    this.ports.window.removeEventListener('blur', this.cancel);
    this.ports.window.removeEventListener('keydown', this.key, true);
    destroyTree(this.layer);
  }
  private down = (event: FederatedPointerEvent): void => {
    if (event.button !== 0 || !this.isShowing()) return;
    const point = this.layer.toLocal(event.global);
    const radius = 10 / Math.max(this.ports.zoom(), 0.001);
    const path = this.paths.getSnapshot().find(p => p.request === this.paths.editingRequest);
    if (path === undefined) return;
    let index = path.points.findIndex(p => Math.hypot(p.x - point.x, p.y - point.y) <= radius);
    if (index < 0 && path.points.length < 32) {
      const points = [path.start, ...path.points];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]; const b = points[i + 1];
        if (a === undefined || b === undefined) continue;
        const dx = b.x - a.x; const dy = b.y - a.y;
        const length = dx * dx + dy * dy;
        const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
        const nearest = { x: a.x + t * dx, y: a.y + t * dy };
        if (Math.hypot(nearest.x - point.x, nearest.y - point.y) <= radius && this.paths.insertPoint(path.request, i, nearest)) { index = i; break; }
      }
    }
    if (index < 0) return;
    event.stopPropagation();
    this.selected = { request: path.request, index };
    this.dragging = { request: path.request, index, pointer: event.pointerId };
    this.ports.gesture(true);
    this.refresh();
  };
  private move = (event: PointerEvent): void => {
    const drag = this.dragging;
    if (drag === null || event.pointerId !== drag.pointer) return;
    event.stopImmediatePropagation(); event.preventDefault();
    if (!this.isShowing()) { this.cancel(); return; }
    this.paths.editPoint(drag.request, drag.index, this.ports.worldPoint(event));
  };
  private up = (event: PointerEvent): void => {
    if (this.dragging === null || event.pointerId !== this.dragging.pointer) return;
    event.stopImmediatePropagation(); event.preventDefault(); this.release();
  };
  private cancel = (): void => { this.release(); this.paths.endEdit(false); };
  private key = (event: KeyboardEvent): void => {
    if (!this.isShowing() || this.paths.editingRequest === null) return;
    const target = event.target;
    if (target && typeof (target as HTMLElement).closest === 'function' && (target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selected !== null) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.paths.deletePoint(this.selected.request, this.selected.index)) { this.selected = null; this.release(); this.refresh(); }
    }
  };
  private isShowing(): boolean {
    let node: Container | null = this.layer;
    while (node !== null) {
      if (!node.visible || !node.renderable || node.destroyed) return false;
      node = node.parent;
    }
    return true;
  }
  private release(): void { if (this.dragging !== null) { this.dragging = null; this.ports.gesture(false); } }
}
