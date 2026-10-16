import type { ClaimResult, PlayerAgencyMessage } from '../protocol/index.ts';
import type { TokenEntity } from '../../types';
import type { Ownership } from './ownership.ts';
import type { TableLog } from './log/TableLog.ts';
import { tokenLabel } from './atlasView.ts';

export type ClaimRequest = Extract<PlayerAgencyMessage, { t: 'claim-request' }>;
export interface PendingClaim extends ClaimRequest {
  readonly from: string;
  readonly tokenId: string;
  readonly playerName: string;
  readonly tokenName: string;
  readonly image: string | null;
}
export interface ClaimPorts {
  readonly ownership: Ownership;
  readonly log: Pick<TableLog, 'action'>;
  current(from: string): { readonly scene: string; readonly mapPath: string; readonly tokens: Readonly<Record<string, TokenEntity>>; tokenId(alias: string): string | undefined; shown(tokenId: string): boolean } | null;
  give(tokenId: string, player: string): void;
  send(message: ClaimResult, to: string): void;
}

export class ClaimRequests {
  private readonly pending = new Map<string, PendingClaim>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private stopped = false;

  constructor(private readonly ports: ClaimPorts) {
    this.unsubscribe = ports.ownership.onChange(() => this.update());
  }

  entries(): readonly PendingClaim[] { return [...this.pending.values()]; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(from: string, message: ClaimRequest): void {
    if (this.stopped) return;
    const previous = this.pending.get(from);
    if (previous?.request === message.request && previous.scene === message.scene && previous.id === message.id) return;
    if (previous !== undefined) this.finish(previous, 'cancelled');
    const current = this.eligible(from, message);
    if (current === null) {
      this.ports.send({ ...message, t: 'claim-result', status: 'cancelled' }, from);
      return;
    }
    this.pending.set(from, current);
    this.ports.send({ t: 'claim-result', scene: current.scene, id: current.id, request: current.request, status: 'pending' }, from);
    this.ports.log.action('claim-request', { player: current.playerName, combatant: current.tokenName, count: null }, [from]);
    this.changed();
  }

  accept(from: string, request: string): void {
    const held = this.pending.get(from);
    if (held === undefined || held.request !== request) return;
    const current = this.eligible(from, held);
    if (current === null || current.tokenId !== held.tokenId) return this.finish(held, 'cancelled');
    this.pending.delete(from);
    this.ports.give(held.tokenId, from);
    if (this.ports.ownership.ownerOf(held.tokenId, this.ports.current(from)?.tokens[held.tokenId]) !== from) {
      this.finish(held, 'cancelled');
      return;
    }
    this.finish(held, 'accepted');
    this.update();
  }

  decline(from: string, request: string): void {
    const held = this.pending.get(from);
    if (held?.request === request) this.finish(held, 'declined');
  }

  playerLeft(from: string): void {
    const held = this.pending.get(from);
    if (held !== undefined) this.finish(held, 'cancelled');
  }

  sceneChanged(): void { this.clear(); }

  update(): void {
    for (const held of this.pending.values()) {
      const current = this.eligible(held.from, held);
      if (current === null || current.tokenId !== held.tokenId) this.finish(held, 'cancelled');
    }
  }

  clear(): void {
    for (const held of this.pending.values()) this.finish(held, 'cancelled');
  }

  stop(): void {
    this.clear();
    this.stopped = true;
    this.unsubscribe();
    this.listeners.clear();
  }

  private eligible(from: string, message: ClaimRequest): PendingClaim | null {
    const { ownership } = this.ports;
    const current = this.ports.current(from);
    const playerName = ownership.nameOf(from);
    if (current === null || current.scene !== message.scene || playerName === null || !ownership.onlinePlayers().includes(from)) return null;
    const tokenId = current.tokenId(message.id);
    const token = tokenId === undefined ? undefined : current.tokens[tokenId];
    if (tokenId === undefined || token === undefined || token.isHidden || !current.shown(tokenId) || ownership.claimOf(current.mapPath, tokenId, token) !== 'open') return null;
    return { ...message, from, tokenId, playerName, tokenName: tokenLabel(token), image: token.imagePath || null };
  }

  private finish(held: PendingClaim, status: 'accepted' | 'declined' | 'cancelled'): void {
    if (this.pending.get(held.from) === held) this.pending.delete(held.from);
    this.ports.send({ t: 'claim-result', scene: held.scene, id: held.id, request: held.request, status }, held.from);
    if (status !== 'cancelled') this.ports.log.action(status === 'accepted' ? 'claim-accepted' : 'claim-declined', { player: held.playerName, combatant: held.tokenName, count: null }, [held.from]);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
