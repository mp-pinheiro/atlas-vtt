import type { GmMessage, PlayerAgencyMessage } from '../protocol';
import type { InitiativeEntry, InitiativeState } from '../../types/initiativeTypes';
import type { InitiativeRules } from '../../types/initiativeRulesTypes';
import type { TokenEntity } from '../../types';
import type { InitiativeSlice } from '../../stores/initiativeSlice';
import type { InitiativeRollResult } from '../../initiative/initiativeRoll';
import { secureRandom } from './secureRandom';

export type InitiativeRequest = Extract<PlayerAgencyMessage, { t: 'initiative-roll' | 'end-turn' }>;

export interface PlayerInitiativeContext {
  readonly scene: string | null;
  readonly initiative: InitiativeState;
  readonly trackerOpen: boolean;
  readonly rules: InitiativeRules;
  readonly tokens: Readonly<Record<string, TokenEntity>>;
  listedCombatant(alias: string): string | undefined;
  ownerOf(tokenId: string): string | undefined;
}

export interface PlayerInitiativePorts {
  context(from: string): PlayerInitiativeContext;
  online(from: string): boolean;
  actionAllowed(from: string): boolean;
  diceAvailable(): boolean;
  modifier(entry: InitiativeEntry): Promise<number | null>;
  defer(from: string, message: InitiativeRequest): boolean;
  actions(): Pick<InitiativeSlice, 'rollEntryInitiative' | 'nextTurn'>;
  send(message: GmMessage, to: string): void;
  refresh(from: string): void;
  rolled(from: string, entry: InitiativeEntry, result: InitiativeRollResult): void;
  turnEnded(from: string, entry: InitiativeEntry): void;
}

interface PreparedRoll {
  readonly entry: InitiativeEntry;
  readonly token: TokenEntity;
  readonly scene: string;
  readonly formula: string;
  readonly rules: string;
  readonly modifier: number | null;
}

export class PlayerInitiative {
  private readonly prepared = new Map<string, PreparedRoll>();
  private readonly lookups = new Map<string, object>();
  private revision: InitiativeState | null = null;
  private authority: string | null = null;
  private generation = 0;

  constructor(private readonly ports: PlayerInitiativePorts) {}

  turnKey(initiative: InitiativeState): string | null {
    if (this.revision !== initiative) {
      this.revision = initiative;
      this.authority = initiative.isActive && !initiative.sides && initiative.entries.length > 0
        ? Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')
        : null;
    }
    return this.authority;
  }

  receive(from: string, message: InitiativeRequest): void {
    if (!this.ports.actionAllowed(from)) return this.refuse(from, message);
    const eligible = this.eligible(from, message);
    if (eligible === null) return this.refuse(from, message);
    if (message.t === 'end-turn') {
      if (!this.ports.defer(from, message)) this.refuse(from, message);
      return;
    }
    const key = JSON.stringify([from, message.scene, message.combatant]);
    if (this.lookups.has(key) || this.prepared.has(key)) return;
    const ticket = {};
    const generation = this.generation;
    const token = eligible.context.tokens[eligible.entry.tokenId]!;
    this.lookups.set(key, ticket);
    void this.ports.modifier(eligible.entry).then(modifier => {
      if (generation !== this.generation || this.lookups.get(key) !== ticket) return;
      this.lookups.delete(key);
      const current = this.eligible(from, message);
      if (current === null || current.entry !== eligible.entry || current.context.tokens[current.entry.tokenId] !== token || JSON.stringify(current.context.rules) !== JSON.stringify(eligible.context.rules)) return this.refuse(from, message);
      this.prepared.set(key, { entry: current.entry, token, scene: message.scene, formula: current.context.rules.roll, rules: JSON.stringify(current.context.rules), modifier });
      if (!this.ports.defer(from, message)) {
        this.prepared.delete(key);
        this.refuse(from, message);
      }
    }, () => {
      if (this.lookups.get(key) !== ticket) return;
      this.lookups.delete(key);
      this.refuse(from, message);
    });
  }

  apply(from: string, message: InitiativeRequest): void {
    const eligible = this.eligible(from, message);
    if (message.t === 'end-turn') {
      if (eligible === null) return this.refuse(from, message);
      this.authority = null;
      this.ports.actions().nextTurn();
      this.ports.turnEnded(from, eligible.entry);
      return;
    }
    const key = JSON.stringify([from, message.scene, message.combatant]);
    const prepared = this.prepared.get(key);
    this.prepared.delete(key);
    if (eligible === null || prepared === undefined || prepared.entry !== eligible.entry || prepared.token !== eligible.context.tokens[eligible.entry.tokenId] || prepared.scene !== message.scene || prepared.rules !== JSON.stringify(eligible.context.rules)) return this.refuse(from, message);
    const result = this.ports.actions().rollEntryInitiative(eligible.entry.id, prepared.formula, prepared.modifier, { random: secureRandom });
    if (result === null) return this.refuse(from, message);
    this.ports.rolled(from, eligible.entry, result);
  }

  cancel(from: string, message: InitiativeRequest): void {
    this.prepared.delete(JSON.stringify([from, message.scene, message.combatant]));
    this.refuse(from, message);
  }

  playerLeft(from: string): void {
    for (const key of this.prepared.keys()) if (JSON.parse(key)[0] === from) this.prepared.delete(key);
    for (const key of this.lookups.keys()) if (JSON.parse(key)[0] === from) this.lookups.delete(key);
  }

  sceneChanged(): void {
    this.generation++;
    this.prepared.clear();
    this.lookups.clear();
    this.revision = null;
    this.authority = null;
  }

  stop(): void {
    this.sceneChanged();
  }

  private eligible(from: string, message: InitiativeRequest): { context: PlayerInitiativeContext; entry: InitiativeEntry } | null {
    const context = this.ports.context(from);
    if (!this.ports.online(from) || context.scene !== message.scene || !context.trackerOpen || context.initiative.sides || (!context.initiative.isActive && context.rules.mode === 'sides')) return null;
    const id = context.listedCombatant(message.combatant);
    const entry = context.initiative.entries.find(value => value.id === id);
    if (entry === undefined || context.tokens[entry.tokenId] === undefined || context.tokens[entry.tokenId]!.isHidden === true || context.ownerOf(entry.tokenId) !== from) return null;
    if (message.t === 'initiative-roll') return entry.hasInitiative === false && this.ports.diceAvailable() ? { context, entry } : null;
    if (!context.initiative.isActive || context.initiative.round !== message.round || context.initiative.entries[context.initiative.currentIndex]?.id !== entry.id || !entry.isActive || this.turnKey(context.initiative) !== message.turnKey) return null;
    return { context, entry };
  }

  private refuse(from: string, message: InitiativeRequest): void {
    this.ports.send({ t: 'initiative-refused', scene: message.scene, combatant: message.combatant, action: message.t === 'initiative-roll' ? 'roll' : 'end-turn' }, from);
    this.ports.refresh(from);
  }
}
