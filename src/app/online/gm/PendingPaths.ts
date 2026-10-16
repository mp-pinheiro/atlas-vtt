import type { PlayerAgencyMessage, GmMessage } from '../protocol/index.ts';
import type { TokenEntity } from '../../types';
import { placeTokens } from '../../stores/tokenStacking';
import { runHistoryTransaction } from '../../stores/history';
import { checkMove, insideMap, landing, type MoveContext } from './moveCheck';
import type { MoveStore } from './playerMoves';

type Path = Extract<PlayerAgencyMessage, { t: 'path' }>;
type Cancel = Extract<PlayerAgencyMessage, { t: 'path-cancel' }>;
export interface PathPoint { readonly x: number; readonly y: number }
export interface PendingPath {
  readonly from: string;
  readonly scene: string;
  readonly id: string;
  readonly request: string;
  readonly tokenId: string;
  readonly token: TokenEntity;
  readonly start: PathPoint;
  readonly points: readonly PathPoint[];
  readonly createdAt: number;
}
export interface ApprovalRequest {
  readonly kind: 'approval'; readonly from: string; readonly scene: string; readonly id: string; readonly request: string;
  readonly path: PendingPath;
}
export interface PendingPathPorts {
  context(from: string): MoveContext;
  approval(): boolean;
  online(from: string): boolean;
  movementAllowed(from: string): boolean;
  defer(request: ApprovalRequest): boolean;
  send(message: GmMessage, to: string): void;
  now(): number;
  setTimer(run: () => void, ms: number): number;
  clearTimer(timer: number): void;
  reminder(path: PendingPath): void;
}
const copyPoints = (points: readonly PathPoint[]): readonly PathPoint[] => Object.freeze(points.map(p => Object.freeze({ x: p.x, y: p.y })));
const MAX_PATH_REQUESTS = 4096;
export class PendingPaths {
  private readonly paths = new Map<string, PendingPath>();
  private readonly timers = new Map<string, number>();
  private readonly requests = new Map<string, Set<string>>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly PendingPath[] = [];
  private editing: { readonly request: string; readonly points: readonly PathPoint[] } | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly store: MoveStore, private readonly ports: PendingPathPorts) {
    this.unsubscribe = store.subscribe(() => this.reconcile());
  }
  get editingRequest(): string | null { return this.editing?.request ?? null; }
  getSnapshot = (): readonly PendingPath[] => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  receive(from: string, message: Path | Cancel): void {
    const movementAllowed = this.ports.movementAllowed(from);
    if (message.t === 'path-cancel') {
      const path = this.paths.get(message.request);
      if (path?.from === from && path.scene === message.scene && path.id === message.id) this.remove(path);
      return;
    }
    if (!movementAllowed) { this.result(from, message, 'refused'); return; }
    const used = this.requests.get(from);
    if (used?.has(message.request)) {
      if (!this.paths.has(message.request)) this.result(from, message, 'stale');
      return;
    }
    if ((used?.size ?? 0) >= MAX_PATH_REQUESTS) { this.result(from, message, 'refused'); return; }
    const context = this.ports.context(from);
    const first = message.points[0];
    const verdict = first === undefined ? null : checkMove(from, { ...message, ...first }, context);
    if (!this.ports.approval() || !this.ports.online(from) || verdict?.ok !== true || !this.loaded() || !this.validPoints(message.points, context)) {
      this.result(from, message, 'refused'); return;
    }
    const token = context.tokens[verdict.tokenId];
    if (token === undefined || this.paths.size >= 128 && ![...this.paths.values()].some(p => p.tokenId === verdict.tokenId)) { this.result(from, message, 'refused'); return; }
    const repeated = this.paths.get(message.request);
    if (repeated !== undefined) return;
    for (const earlier of [...this.paths.values()]) if (earlier.tokenId === verdict.tokenId) this.remove(earlier, 'replaced');
    const path: PendingPath = Object.freeze({ from, scene: message.scene, id: message.id, request: message.request, tokenId: verdict.tokenId, token, start: Object.freeze({ x: token.x, y: token.y }), points: copyPoints(message.points), createdAt: this.ports.now() });
    this.paths.set(path.request, path);
    const requests = used ?? new Set<string>();
    requests.add(path.request);
    this.requests.set(from, requests);
    this.timers.set(path.request, this.ports.setTimer(() => {
      this.timers.delete(path.request);
      const current = this.paths.get(path.request);
      if (current !== undefined && this.eligible(current)) this.ports.reminder(current);
      else if (current !== undefined) this.remove(current, 'stale');
    }, 30_001));
    this.changed();
  }
  approve(request: string): void {
    const path = this.paths.get(request);
    if (path !== undefined && !this.ports.defer({ kind: 'approval', from: path.from, scene: path.scene, id: path.id, request, path }) && this.paths.get(request) === path) this.remove(path, 'refused');
  }
  apply(from: string, request: Omit<ApprovalRequest, 'kind' | 'from'>): void {
    const path = this.paths.get(request.request);
    if (path === undefined || path !== request.path || path.from !== from || path.scene !== request.scene || path.id !== request.id) return;
    if (!this.eligible(path)) { this.remove(path, 'stale'); return; }
    const context = this.ports.context(from);
    let at = path.start;
    const accepted: PathPoint[] = [];
    let blocked = false;
    for (const point of path.points) {
      at = landing(context, at, point);
      accepted.push(at);
      if (at.x !== point.x || at.y !== point.y) { blocked = true; break; }
    }
    this.detach(path);
    runHistoryTransaction(this.store, () => this.store.setState(draft => placeTokens(draft, [{ id: path.tokenId, x: at.x, y: at.y }])));
    this.ports.send({ t: 'path-result', scene: path.scene, id: path.id, request: path.request, result: 'approved', ...(blocked ? { reason: 'blocked' as const } : {}), points: accepted }, from);
    this.changed();
  }
  cancel(request: string): void { const path = this.paths.get(request); if (path !== undefined) this.remove(path, 'refused'); }
  cancelApproval(request: ApprovalRequest): void {
    if (this.paths.get(request.request) === request.path) this.remove(request.path, 'refused');
  }
  approveAll(): void { for (const request of this.snapshot.map(p => p.request)) this.approve(request); }
  cancelAll(): void { for (const request of this.snapshot.map(p => p.request)) this.cancel(request); }
  beginEdit(request: string): void {
    this.endEdit(false);
    const path = this.paths.get(request);
    if (path !== undefined) { this.editing = { request, points: path.points }; this.changed(); }
  }
  editPoint(request: string, index: number, point: PathPoint): boolean {
    const path = this.paths.get(request);
    if (this.editing?.request !== request || path === undefined || index < 0 || index >= path.points.length) return false;
    return this.replacePoints(path, path.points.map((p, i) => i === index ? point : p));
  }
  insertPoint(request: string, index: number, point: PathPoint): boolean {
    const path = this.paths.get(request);
    if (this.editing?.request !== request || path === undefined || path.points.length >= 32 || index < 0 || index > path.points.length) return false;
    const points = [...path.points]; points.splice(index, 0, point); return this.replacePoints(path, points);
  }
  deletePoint(request: string, index: number): boolean {
    const path = this.paths.get(request);
    if (this.editing?.request !== request || path === undefined || path.points.length <= 1 || index < 0 || index >= path.points.length) return false;
    return this.replacePoints(path, path.points.filter((_, i) => i !== index));
  }
  endEdit(commit: boolean): void {
    const edit = this.editing; this.editing = null;
    const path = edit === null ? undefined : this.paths.get(edit.request);
    if (!commit && path !== undefined && edit !== null) this.replacePoints(path, edit.points);
    this.changed();
  }
  reconcile(): void { for (const path of [...this.paths.values()]) if (!this.eligible(path)) this.remove(path, 'stale'); }
  playerLeft(from: string): void {
    this.requests.delete(from);
    for (const path of [...this.paths.values()]) if (path.from === from) this.remove(path, 'stale');
  }
  sceneChanged(): void {
    this.requests.clear();
    for (const path of [...this.paths.values()]) this.remove(path, 'stale');
  }
  stop(): void { this.sceneChanged(); this.unsubscribe(); this.listeners.clear(); }
  private loaded(): boolean { const s = this.store.getState(); return s.mapLoaded && !s.isMapLoading; }
  private eligible(path: PendingPath): boolean {
    const context = this.ports.context(path.from);
    const token = context.tokens[path.tokenId];
    return this.loaded() && this.ports.approval() && this.ports.online(path.from) && context.scene === path.scene && context.listedToken(path.id) === path.tokenId && context.ownerOf(path.tokenId) === path.from && token === path.token && token.isHidden !== true && token.x === path.start.x && token.y === path.start.y && this.validPoints(path.points, context);
  }
  private validPoints(points: readonly PathPoint[], context: MoveContext): boolean { return points.length > 0 && points.length <= 32 && points.every(p => insideMap(p.x, p.y, context.map)); }
  private replacePoints(path: PendingPath, points: readonly PathPoint[]): boolean {
    if (!this.validPoints(points, this.ports.context(path.from))) return false;
    this.paths.set(path.request, Object.freeze({ ...path, points: copyPoints(points) })); this.changed(); return true;
  }
  private result(from: string, path: Pick<Path, 'scene' | 'id' | 'request'>, reason?: 'stale' | 'replaced' | 'refused'): void {
    this.ports.send({ t: 'path-result', scene: path.scene, id: path.id, request: path.request, result: 'cancelled', ...(reason === undefined ? {} : { reason }) }, from);
  }
  private remove(path: PendingPath, reason?: 'stale' | 'replaced' | 'refused'): void { this.detach(path); this.result(path.from, path, reason); this.changed(); }
  private detach(path: PendingPath): void {
    this.paths.delete(path.request);
    const timer = this.timers.get(path.request); if (timer !== undefined) this.ports.clearTimer(timer);
    this.timers.delete(path.request);
    if (this.editing?.request === path.request) this.editing = null;
  }
  private changed(): void { this.snapshot = [...this.paths.values()]; for (const listener of this.listeners) listener(); }
}
