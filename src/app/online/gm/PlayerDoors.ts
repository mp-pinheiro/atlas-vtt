import type { PlayerAgencyMessage, GmMessage } from '../protocol/index';
import type { TokenEntity } from '../../types';
import type { WallSegment } from '../../types/wallTypes';
import { runHistoryTransaction } from '../../stores/history';

type DoorRequest = Extract<PlayerAgencyMessage, { t: 'door' }>;
export interface PlayerDoorContext {
  readonly scene: string | null;
  readonly enabled: boolean;
  readonly lit: boolean;
  readonly gridSize: number;
  readonly walls: Readonly<Record<string, WallSegment>>;
  readonly tokens: Readonly<Record<string, TokenEntity>>;
  listedDoor(alias: string): string | undefined;
  listedToken(tokenId: string): boolean;
  ownerOf(tokenId: string): string | undefined;
  visibleDoor(wallId: string): boolean;
}
export interface PlayerDoorPorts {
  readonly nonces?: Map<string, Set<string>> | undefined;
  context(from: string): PlayerDoorContext;
  movementAllowed(from: string): boolean;
  defer(request: { readonly kind: 'door'; readonly from: string; readonly message: DoorRequest }): boolean;
  send(message: GmMessage, to: string): void;
}
export interface DoorStore {
  getState(): { readonly mapLoaded: boolean; readonly isMapLoading: boolean; toggleDoor(id: string): void };
}
export class PlayerDoors {
  private readonly seen: Map<string, Set<string>>;
  private readonly pending = new Map<string, Map<string, DoorRequest>>();
  constructor(private readonly store: DoorStore, private readonly ports: PlayerDoorPorts) {
    this.seen = ports.nonces ?? new Map<string, Set<string>>();
  }
  receive(from: string, message: DoorRequest): void {
    const allowed = this.ports.movementAllowed(from);
    const seen = this.seen.get(from) ?? new Set<string>();
    if (seen.has(message.request)) return;
    if (seen.size >= 4096) { this.refuse(from, message); return; }
    seen.add(message.request); this.seen.set(from, seen);
    if (!allowed || !this.eligible(from, message)) { this.refuse(from, message); return; }
    const pending = this.pending.get(from) ?? new Map<string, DoorRequest>();
    pending.set(message.request, message); this.pending.set(from, pending);
    if (!this.ports.defer({ kind: 'door', from, message }) && pending.delete(message.request)) this.refuse(from, message);
  }
  apply(from: string, message: DoorRequest): void {
    const pending = this.pending.get(from);
    const original = pending?.get(message.request);
    if (original === undefined || original.scene !== message.scene || original.id !== message.id) return;
    pending?.delete(message.request);
    const wall = this.eligible(from, message);
    if (wall === null) { this.refuse(from, message); return; }
    runHistoryTransaction(this.store, () => this.store.getState().toggleDoor(wall.id));
    const current = this.ports.context(from).walls[wall.id];
    this.ports.send({ t: 'door-result', scene: message.scene, id: message.id, request: message.request, result: current?.closed === false ? 'opened' : 'closed' }, from);
  }
  cancel(from: string, message: DoorRequest): void {
    if (this.pending.get(from)?.delete(message.request)) this.refuse(from, message);
  }
  playerLeft(from: string): void { this.pending.delete(from); this.seen.delete(from); }
  sceneChanged(): void {
    const pending = [...this.pending.entries()]; this.pending.clear();
    for (const [from, messages] of pending) for (const message of messages.values()) this.refuse(from, message);
  }
  stop(): void { this.sceneChanged(); if (this.ports.nonces === undefined) this.seen.clear(); }
  private eligible(from: string, message: DoorRequest): WallSegment | null {
    const state = this.store.getState();
    const c = this.ports.context(from);
    if (!state.mapLoaded || state.isMapLoading || !c.enabled || !c.lit || c.scene !== message.scene || !Number.isFinite(c.gridSize) || c.gridSize <= 0) return null;
    const id = c.listedDoor(message.id);
    const wall = id === undefined ? undefined : c.walls[id];
    if (wall === undefined || wall.type !== 'door' || wall.locked === true || !c.visibleDoor(wall.id)) return null;
    const x = (wall.p1.x + wall.p2.x) / 2;
    const y = (wall.p1.y + wall.p2.y) / 2;
    for (const [tokenId, token] of Object.entries(c.tokens)) {
      if (token.isHidden !== true && c.ownerOf(tokenId) === from && c.listedToken(tokenId) && Math.hypot(token.x - x, token.y - y) <= c.gridSize) return wall;
    }
    return null;
  }
  private refuse(from: string, message: DoorRequest): void { this.ports.send({ t: 'door-result', scene: message.scene, id: message.id, request: message.request, result: 'refused' }, from); }
}
