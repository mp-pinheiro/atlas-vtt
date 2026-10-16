import { isHistoryBusy, onHistorySettled, runHistoryTransaction, type HistoryHost } from '../../stores/history';
import type { PlayerAgencyMessage } from '../protocol/agency';
import type { PlayerSheetMessage } from '../protocol/sheet';
import type { Timers } from './companionTimers';
import type { TokenResourceEdit } from './book/resourceWrites';
import type { ApprovalRequest } from './PendingPaths';

type AgencyWriteKind = 'condition' | 'end-turn' | 'initiative-roll' | 'door';
type AgencyWrite = { [K in AgencyWriteKind]: { readonly kind: K; readonly from: string; readonly message: Extract<PlayerAgencyMessage, { readonly t: K }> } }[AgencyWriteKind];
export type DeferredSceneRequest = AgencyWrite
  | { readonly kind: 'sheet-roll'; readonly from: string; readonly message: PlayerSheetMessage }
  | ApprovalRequest
  | { readonly kind: 'resource'; readonly from: string; readonly edit: TokenResourceEdit; readonly ticket: number };
export type DeferredCancelReason = 'replaced' | 'cleared' | 'full' | 'stopped';
export interface DeferredSceneStore extends HistoryHost {
  getState(): { readonly heldTokens?: Readonly<Record<string, unknown>>; readonly isDragging?: boolean };
  subscribe(listener: () => void): () => void;
}
export interface DeferredScenePorts extends Pick<Timers, 'setTimer' | 'clearTimer'> {
  apply(request: DeferredSceneRequest): void;
  cancel(request: DeferredSceneRequest, reason: DeferredCancelReason): void;
}

export class DeferredSceneWrites {
  private readonly waiting = new Map<string, DeferredSceneRequest>();
  private readonly doors = new Map<string, Set<string>>();
  private readonly unsubscribe: readonly (() => void)[];
  private serial = 0;
  private timer: number | undefined;
  private stopped = false;

  constructor(private readonly store: DeferredSceneStore, private readonly ports: DeferredScenePorts) {
    this.unsubscribe = [store.subscribe(() => this.schedule()), onHistorySettled(store, () => this.schedule())];
  }

  get size(): number { return this.waiting.size; }

  enqueue(input: DeferredSceneRequest): boolean {
    const request = Object.freeze(input.kind === 'resource'
      ? { ...input, edit: Object.freeze({ ...input.edit }) }
      : 'message' in input ? { ...input, message: Object.freeze({ ...input.message }) } : { ...input }) as DeferredSceneRequest;
    if (this.stopped) { this.ports.cancel(request, 'stopped'); return false; }
    if (request.kind === 'door') {
      const seen = this.doors.get(request.from);
      if (seen?.has(request.message.request)) return true;
      if ((seen?.size ?? 0) >= 4096) { this.ports.cancel(request, 'full'); return false; }
    }
    let key: string;
    switch (request.kind) {
      case 'condition': key = JSON.stringify([request.kind, request.from, request.message.scene, request.message.id, request.message.condition]); break;
      case 'resource': key = JSON.stringify([request.kind, request.from, request.edit.tokenId, request.edit.key]); break;
      case 'end-turn': key = JSON.stringify([request.kind, request.from, request.message.scene, request.message.turnKey]); break;
      case 'approval': key = JSON.stringify([request.kind, request.from, request.scene, request.id, request.request]); break;
      default: key = String(++this.serial);
    }
    const previous = this.waiting.get(key);
    if (previous && (request.kind === 'end-turn' || request.kind === 'approval' && previous.kind === 'approval' && request.path === previous.path)) return true;
    if (!previous && this.waiting.size >= 128) { this.ports.cancel(request, 'full'); return false; }
    if (request.kind === 'door') {
      let seen = this.doors.get(request.from);
      if (!seen) this.doors.set(request.from, seen = new Set());
      seen.add(request.message.request);
    }
    this.waiting.set(key, request);
    if (previous) this.ports.cancel(previous, 'replaced');
    if (!this.blocked() && this.timer === undefined) this.flush();
    else this.schedule();
    return true;
  }

  clearPlayer(from: string): void {
    this.doors.delete(from);
    for (const [key, request] of [...this.waiting]) {
      if (request.from !== from) continue;
      this.waiting.delete(key);
      this.ports.cancel(request, 'cleared');
    }
  }

  clear(): void {
    this.cancelWaiting('cleared');
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.cancelWaiting('stopped');
    this.doors.clear();
  }

  private cancelWaiting(reason: DeferredCancelReason): void {
    if (this.timer !== undefined) this.ports.clearTimer(this.timer);
    this.timer = undefined;
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    for (const request of waiting) this.ports.cancel(request, reason);
  }

  private blocked(): boolean {
    const state = this.store.getState();
    return isHistoryBusy(this.store) || state.isDragging === true || Object.keys(state.heldTokens ?? {}).length > 0;
  }

  private schedule(): void {
    if (this.stopped || this.waiting.size === 0 || this.timer !== undefined || this.blocked()) return;
    this.timer = this.ports.setTimer(() => {
      this.timer = undefined;
      this.flush();
    }, 0);
  }

  private flush(): void {
    while (!this.stopped && this.waiting.size > 0 && !this.blocked()) {
      const [key, request] = this.waiting.entries().next().value!;
      this.waiting.delete(key);
      runHistoryTransaction(this.store, () => this.ports.apply(request));
    }
  }
}
