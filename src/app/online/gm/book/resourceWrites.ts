import type { ResourceDefinition } from '../../../resources/resourceTypes';
import { resourceUpdate, withCurrent } from '../../../resources/resourceValues';
import type { ViewState } from '../../../types/viewState';
import type { Timers } from '../companionTimers.ts';
import { editableValue, type ResourceEdit } from './resourceEdit.ts';
import { DeferredSceneWrites, type DeferredSceneRequest } from '../DeferredSceneWrites';

/** An edit of a token in the shared scene. */
export type TokenResourceEdit = Extract<ResourceEdit, { readonly kind: 'token' }>;
export type DeferredResourceRequest = Extract<DeferredSceneRequest, { readonly kind: 'resource' }>;
/** What became of an edit: the current value the resource holds after it, or null when it was refused. */
export type ResourceAnswer = (taken: number | null) => void;

/** What resource writes read and write of an Atlas tab's store. */
export type ResourceWriteState = Pick<ViewState, 'objects' | 'mapLoaded' | 'isMapLoading' | 'isDragging' | 'heldTokens'> & Partial<Pick<ViewState, 'mapPath'>>;

export interface ResourceWriteStore {
  getState(): ResourceWriteState;
  /** A write as the GM's own: Atlas's history records it as one undo step. */
  setState(recipe: (draft: ResourceWriteState) => void): void;
  subscribe(listener: (state: ResourceWriteState) => void): () => void;
}

export interface ResourceWritePorts extends Timers {
  /** The resource definitions the scene's tokens are drawn by. */
  definitions(): readonly ResourceDefinition[];
  ownerOf(tokenId: string): string | undefined;
  defer?(request: DeferredResourceRequest): boolean;
  online?(from: string): boolean;
}

const loaded = (state: ResourceWriteState): boolean => state.mapLoaded && !state.isMapLoading;
let nextTicket = 0;

/**
 * Players' edits of their characters' resources on the shared scene, written as the GM's own: one
 * undo step each, through `resourceUpdate` on the token as the store holds it then, clamped to the
 * resource's range. While anyone holds tokens (the GM's drag, a player's drag: a write would join
 * that drag's undo step) an edit waits, the latest of each token and resource, and is taken once
 * the hold has ended, checked again: the token must still be its sender's and the resource one
 * they may change. An edit that is not taken is answered with null.
 */
export class ResourceWrites {
  private readonly store: ResourceWriteStore;
  private readonly ports: ResourceWritePorts;
  private readonly answers = new Map<number, { readonly answer: ResourceAnswer; readonly from: string; readonly mapPath: string | null | undefined }>();
  private writes: DeferredSceneWrites | null = null;

  constructor(store: ResourceWriteStore, ports: ResourceWritePorts) {
    this.store = store;
    this.ports = ports;
  }

  start(): void {
    if (this.ports.defer) return;
    this.writes ??= new DeferredSceneWrites(this.store, {
      setTimer: (fn, delay) => this.ports.setTimer(fn, delay),
      clearTimer: (id) => this.ports.clearTimer(id),
      apply: (request) => {
        if (request.kind !== 'resource') return;
        this.applyDeferred(request);
      },
      cancel: (request) => {
        if (request.kind !== 'resource') return;
        this.cancelDeferred(request);
      },
    });
  }

  /** Ends the writes: edits that wait are refused. */
  stop(): void {
    this.writes?.stop();
    this.writes = null;
    const answers = [...this.answers.values()];
    this.answers.clear();
    for (const { answer } of answers) answer(null);
  }

  write(edit: TokenResourceEdit, answer: ResourceAnswer): void {
    const state = this.store.getState();
    if (!loaded(state) || this.ports.online?.(edit.from) === false) return answer(null);
    this.start();
    const ticket = ++nextTicket;
    this.answers.set(ticket, { answer, from: edit.from, mapPath: state.mapPath });
    const request: DeferredResourceRequest = { kind: 'resource', from: edit.from, edit, ticket };
    if (this.ports.defer) {
      if (!this.ports.defer(request)) this.cancelDeferred(request);
    } else this.writes!.enqueue(request);
  }

  applyDeferred(request: DeferredResourceRequest): void {
    const pending = this.answers.get(request.ticket);
    this.answers.delete(request.ticket);
    if (!pending) return;
    if (pending.from !== request.from || pending.mapPath !== this.store.getState().mapPath || this.ports.online?.(request.from) === false) {
      pending.answer(null);
      return;
    }
    this.apply(request.edit, pending.answer);
  }

  cancelDeferred(request: DeferredResourceRequest): void {
    const pending = this.answers.get(request.ticket);
    this.answers.delete(request.ticket);
    pending?.answer(null);
  }

  playerLeft(from: string): void {
    this.writes?.clearPlayer(from);
    for (const [ticket, pending] of [...this.answers]) {
      if (pending.from !== from) continue;
      this.answers.delete(ticket);
      pending.answer(null);
    }
  }


  private apply(edit: TokenResourceEdit, answer: ResourceAnswer): void {
    const state = this.store.getState();
    const token = state.objects.tokens[edit.tokenId];
    const value = token === undefined || !loaded(state) || this.ports.ownerOf(edit.tokenId) !== edit.from ? null : editableValue(token, this.ports.definitions(), edit.key);
    if (token === undefined || value === null) return answer(null);
    const next = withCurrent(value, edit.current);
    if (next.current !== value.current) {
      const update = resourceUpdate(token, edit.key, next, false);
      this.store.setState((draft) => {
        const live = draft.objects.tokens[edit.tokenId];
        if (live !== undefined) Object.assign(live, update);
      });
    }
    answer(next.current);
  }
}
