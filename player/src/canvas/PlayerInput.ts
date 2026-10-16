import type { Viewport } from 'pixi-viewport';
import { snapTokenCenter } from '../../../src/app/grid/gridPlacement.ts';
import { createHexLayout, nearestHexCenter } from '../../../src/app/grid/hexGeometry.ts';
import { movementWalls } from '../../../src/app/online/movement/movementWalls.ts';
import { stopAtWalls } from '../../../src/app/online/movement/wallCollision.ts';
import { readWall } from '../../../src/app/lighting/lightingObjects.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { PlayerState } from '../state/playerStore.ts';

export type PlayerTool = 'select' | 'pan' | 'measure' | 'laser';
export interface PlayerPoint { readonly x: number; readonly y: number }
export interface ProposalPort { begin(id: string, point: PlayerPoint): void; move(point: PlayerPoint): void; finish(point: PlayerPoint): void; cancel(): void; key(event: KeyboardEvent): void }
export interface InputPorts {
  state(): PlayerState | null;
  pick(x: number, y: number): string | null;
  activate(x: number, y: number): boolean;
  send(message: PlayerMessage): boolean;
  changed(): void;
  dimensions(): { width: number; height: number };
  proposal?: ProposalPort;
}
export class PlayerInput {
  tool: PlayerTool = 'select';
  selected: string | null = null;
  get predictions(): Readonly<Record<string, PlayerPoint>> { return this.ports.state()?.predictions ?? {}; }
  private gesture: { pointer: number; id: string | null; start: PlayerPoint; last: PlayerPoint; pan: boolean; scene: string } | null = null;
  private proposal: { id: string; scene: string; request: string; points: PlayerPoint[]; submitted: boolean; cancelInFlight: boolean } | null = null;
  private lastSample = 0;
  private lastCursor = 0;
  private lastStep = 0;
  private generation = -1;
  private transportGeneration = -1;
  private approval = false;
  private readonly feedbackSeen = new WeakSet<object>();
  constructor(private readonly canvas: HTMLCanvasElement, private readonly viewport: Viewport, private readonly ports: InputPorts) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.cancel);
    canvas.addEventListener('dblclick', this.submit);
    canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('contextmenu', this.contextmenu);
    window.addEventListener('blur', this.blur);
    window.addEventListener('keydown', this.key);
  }
  update(state: PlayerState): void {
    const approval = state.scene?.agency?.permissions.approval ?? false;
    if (this.approval !== approval) { this.approval = approval; this.cancel(); this.clearProposal(); }
    if (this.generation !== state.generation || this.transportGeneration !== state.transportGeneration || (this.selected && !state.scene?.mine?.tokens.includes(this.selected)) || !state.gmOnline) {
      this.generation = state.generation; this.transportGeneration = state.transportGeneration;
      this.cancel(); this.clearProposal(); this.selected = null;
    }
    for (const feedback of state.feedback) {
      if (this.feedbackSeen.has(feedback)) continue;
      this.feedbackSeen.add(feedback);
      if (this.gesture?.id === feedback.request && feedback.status === 'refused') this.cancel();
    }
    if (this.proposal) {
      const feedback = state.feedback.find((entry) => entry.request === this.proposal?.request);
      if (feedback?.status === 'pending') {
        this.proposal.submitted = true;
        this.proposal.cancelInFlight = feedback.cancelInFlight === true;
      } else if (feedback !== undefined) this.clearProposal();
    }
  }
  private point(event: PointerEvent | MouseEvent): PlayerPoint {
    const rect = this.canvas.getBoundingClientRect();
    return this.viewport.toWorld(event.clientX - rect.left, event.clientY - rect.top);
  }
  private destination(id: string, point: PlayerPoint, free: boolean, clip: boolean): PlayerPoint {
    const scene = this.ports.state()?.scene;
    const token = scene?.tokens?.tokens.find((entry) => entry.id === id);
    const grid = scene?.tokens?.snap;
    let result = point;
    if (grid && !free && token) result = snapTokenCenter(point, token.cells, grid.type, grid.size, (p) => grid.type === 'square' ? { x: grid.offsetX + (Math.floor((p.x - grid.offsetX) / grid.size) + 0.5) * grid.size, y: grid.offsetY + (Math.floor((p.y - grid.offsetY) / grid.size) + 0.5) * grid.size } : nearestHexCenter(createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY), p));
    const bounds = this.ports.dimensions();
    result = { x: Math.max(0, Math.min(bounds.width, result.x)), y: Math.max(0, Math.min(bounds.height, result.y)) };
    if (clip && token && scene?.lighting) {
      const walls = scene.lighting.walls.flatMap((wall, index) => { const value = readWall({ id: String(index), p1: { x: wall.p[0], y: wall.p[1] }, p2: { x: wall.p[2], y: wall.p[3] }, kind: 'wall', type: wall.door ? 'door' : 'solid', closed: wall.door === 'closed', direction: wall.direction, blocks: wall.blocks }); return value ? [value] : []; });
      result = stopAtWalls(movementWalls(walls, bounds), token, result);
    }
    return result;
  }
  private readonly down = (event: PointerEvent): void => {
    if (this.gesture || (event.button !== 0 && event.button !== 2)) return;
    const state = this.ports.state();
    if (!state?.scene || state.scene.covered) return;
    const point = this.point(event);
    const pan = event.button === 2 || this.tool === 'pan';
    if (!pan && !state.gmOnline) return;
    if (!pan && this.tool === 'select' && this.ports.activate(point.x, point.y)) return;
    const picked = !pan && this.tool === 'select' ? this.ports.pick(point.x, point.y) : null;
    const id = picked && state.scene.mine?.tokens.includes(picked) ? picked : null;
    if (!pan && (this.proposal?.submitted || this.proposal?.cancelInFlight)) return;
    if (!pan && this.tool === 'select' && !id) {
      if (this.proposal && this.proposal.points.length < 32) { this.proposal.points.push(this.destination(this.proposal.id, point, event.altKey, false)); this.notify(); }
      return;
    }
    this.selected = id;
    this.gesture = { pointer: event.pointerId, id, start: point, last: point, pan, scene: state.scene.scene.id };
    this.canvas.setPointerCapture(event.pointerId);
    if (id && state.scene.agency?.permissions.approval) {
      if (this.ports.proposal) this.ports.proposal.begin(id, point);
      else { this.clearProposal(); this.proposal = { id, scene: state.scene.scene.id, request: nonce(), points: [point], submitted: false, cancelInFlight: false }; }
      this.notify();
    }
    event.preventDefault();
  };
  private readonly move = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture) {
      const state = this.ports.state();
      if (state?.gmOnline && state.scene?.rules?.cursors && !state.scene.covered && performance.now() - this.lastCursor >= 100) {
        const point = this.point(event);
        this.lastCursor = performance.now();
        this.ports.send({ t: 'cursor', scene: state.scene.scene.id, at: [point.x, point.y], pts: [point.x, point.y] });
      }
      return;
    }
    if (gesture.pointer !== event.pointerId) return;
    const point = this.point(event);
    if (gesture.pan) { this.viewport.x += (point.x - gesture.last.x) * this.viewport.scale.x; this.viewport.y += (point.y - gesture.last.y) * this.viewport.scale.y; gesture.last = this.point(event); this.ports.changed(); return; }
    gesture.last = point;
    const scene = this.ports.state()?.scene;
    const now = performance.now();
    if (gesture.id) {
      if (scene?.agency?.permissions.approval) {
        const destination = this.destination(gesture.id, point, event.altKey, false);
        if (this.ports.proposal) this.ports.proposal.move(destination);
        else if (this.proposal) this.proposal.points[this.proposal.points.length - 1] = destination;
      } else {
        const destination = this.destination(gesture.id, point, true, true);
        this.ports.state()?.setPrediction(gesture.id, destination);
        if (now - this.lastSample >= 50) { this.lastSample = now; this.ports.send({ t: 'drag', scene: gesture.scene, id: gesture.id, ...destination }); }
      }
    } else if (now - this.lastSample >= 100) { this.lastSample = now; this.mark(point, false); }
    this.notify();
  };
  private readonly up = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const point = this.point(event);
    this.gesture = null;
    if (gesture.id) {
      const scene = this.ports.state()?.scene;
      const destination = this.destination(gesture.id, point, event.altKey, !scene?.agency?.permissions.approval);
      if (scene?.agency?.permissions.approval) { if (this.ports.proposal) this.ports.proposal.finish(destination); else if (this.proposal) this.proposal.points[this.proposal.points.length - 1] = destination; }
      else { this.ports.send({ t: 'move', scene: gesture.scene, id: gesture.id, ...destination }); this.ports.state()?.setPrediction(gesture.id, null); }
    } else if (!gesture.pan) { this.gesture = gesture; this.mark(point, true); this.gesture = null; }
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.notify();
  };
  private mark(point: PlayerPoint, terminal: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (this.tool === 'laser') this.ports.send({ t: 'laser', scene: gesture.scene, color: '#ffffff', size: 1, on: !terminal, at: terminal ? null : [point.x, point.y], pts: terminal ? [] : [point.x, point.y] });
    if (this.tool === 'measure') this.ports.send({ t: 'measure', scene: gesture.scene, color: '#ffffff', live: terminal ? null : { shape: 'line', a: [gesture.start.x, gesture.start.y], b: [point.x, point.y] }, kept: terminal ? [{ shape: 'line', a: [gesture.start.x, gesture.start.y], b: [point.x, point.y] }] : [] });
  }
  readonly cancel = (): void => {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) return;
    if (gesture.id) {
      this.ports.state()?.setPrediction(gesture.id, null);
      if (!this.ports.state()?.scene?.agency?.permissions.approval) this.ports.send({ t: 'drag-cancel', scene: gesture.scene, id: gesture.id });
      else this.clearDraftProposal();
    }
    if (!gesture.id && !gesture.pan) {
      if (this.tool === 'laser') this.ports.send({ t: 'laser', scene: gesture.scene, color: '#ffffff', size: 1, on: false, at: null, pts: [] });
      if (this.tool === 'measure') this.ports.send({ t: 'measure', scene: gesture.scene, color: '#ffffff', live: null, kept: [] });
    }
    if (this.canvas.hasPointerCapture(gesture.pointer)) this.canvas.releasePointerCapture(gesture.pointer);
    this.ports.changed();
  };
  private clearProposal(): void {
    const proposal = this.proposal;
    if (!proposal) return;
    this.proposal = null;
    this.ports.state()?.setProposal(proposal.id, null);
    this.ports.proposal?.cancel();
  }
  private clearDraftProposal(): void {
    if (this.proposal && !this.proposal.submitted) this.clearProposal();
  }
  private requestProposalCancellation(): void {
    const proposal = this.proposal;
    if (!proposal) return;
    if (!proposal.submitted) { this.clearProposal(); return; }
    if (proposal.cancelInFlight) return;
    if (!this.ports.send({ t: 'path-cancel', scene: proposal.scene, id: proposal.id, request: proposal.request })) return;
    proposal.cancelInFlight = true;
    this.notify();
  }
  readonly submit = (): void => {
    const proposal = this.proposal;
    if (!proposal || proposal.submitted || proposal.cancelInFlight) return;
    if (this.ports.send({ t: 'path', scene: proposal.scene, id: proposal.id, request: proposal.request, points: [...proposal.points] })) {
      proposal.submitted = true;
      this.notify();
    }
  };
  get proposalRequest(): string | null { return this.proposal?.request ?? null; }
  get proposalPoints(): readonly PlayerPoint[] { return this.proposal ? this.ports.state()?.proposals[this.proposal.id] ?? this.proposal.points : []; }
  proposalAction(action: 'submit' | 'remove-last' | 'cancel'): void {
    if (action === 'submit') this.submit();
    if (action === 'cancel') { this.cancel(); this.requestProposalCancellation(); }
    if (action === 'remove-last' && this.proposal && !this.proposal.submitted && !this.proposal.cancelInFlight && this.proposal.points.length > 1) this.proposal.points.pop();
    this.notify();
  }
  private readonly blur = (): void => {
    this.cancel();
    this.clearDraftProposal();
    this.leave();
    this.ports.changed();
  };

  private readonly key = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement | null)?.closest('input,textarea,button,[contenteditable=true]')) return;
    this.ports.proposal?.key(event);
    if (event.key === 'Escape') { this.cancel(); this.requestProposalCancellation(); this.ports.changed(); }
    if (this.proposal && !this.proposal.submitted && !this.proposal.cancelInFlight && event.key === 'Backspace') { if (this.proposal.points.length > 1) this.proposal.points.pop(); event.preventDefault(); this.notify(); }
    if (this.proposal && event.key === 'Enter') { this.submit(); event.preventDefault(); }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const state = this.ports.state();
    const token = state?.scene?.tokens?.tokens.find((entry) => entry.id === this.selected);
    if (!step || !token || !state?.gmOnline || !state.scene || performance.now() - this.lastStep < 200) return;
    event.preventDefault(); this.lastStep = performance.now();
    const cell = state.scene.tokens!.cell;
    const point = this.destination(token.id, { x: token.x + step[0]! * cell, y: token.y + step[1]! * cell }, event.altKey, !state.scene.agency?.permissions.approval);
    if (state.scene.agency?.permissions.approval) {
      if (this.proposal?.submitted || this.proposal?.cancelInFlight) return;
      this.clearProposal();
      this.proposal = { id: token.id, scene: state.scene.scene.id, request: nonce(), points: [point], submitted: false, cancelInFlight: false };
    }
    else this.ports.send({ t: 'move', scene: state.scene.scene.id, id: token.id, ...point });
    this.notify();
  };
  private notify(): void {
    if (this.proposal) this.ports.state()?.setProposal(this.proposal.id, [...this.proposal.points]);
    this.ports.changed();
  }
  private readonly contextmenu = (event: MouseEvent): void => { event.preventDefault(); };
  private readonly leave = (): void => {
    const scene = this.ports.state()?.scene;
    if (scene?.rules?.cursors) this.ports.send({ t: 'cursor', scene: scene.scene.id, at: null, pts: [] });
  };
  destroy(): void { this.cancel(); this.clearProposal(); this.canvas.removeEventListener('pointerdown', this.down); this.canvas.removeEventListener('pointermove', this.move); this.canvas.removeEventListener('pointerup', this.up); this.canvas.removeEventListener('pointercancel', this.cancel); this.canvas.removeEventListener('lostpointercapture', this.cancel); this.canvas.removeEventListener('dblclick', this.submit); this.canvas.removeEventListener('pointerleave', this.leave); this.canvas.removeEventListener('contextmenu', this.contextmenu); window.removeEventListener('blur', this.blur); window.removeEventListener('keydown', this.key); }
}
function nonce(): string { return Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => value.toString(16).padStart(2, '0')).join(''); }
