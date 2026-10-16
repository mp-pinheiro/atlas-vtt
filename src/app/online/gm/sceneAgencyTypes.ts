import type { AgencyMessage, GmMessage, PlayerMessage } from '../protocol';
import type { ViewState } from '../../types/viewState';
import type { InitiativeEntry } from '../../types/initiativeTypes';
import type { InitiativeRules } from '../../types/initiativeRulesTypes';
import type { DiceSet, RollingDice } from '../../types/diceSetTypes';
import type { DiceRules } from '../../types/diceRulesTypes';
import type { Ownership } from './ownership';
import type { TableLog } from './log/TableLog';
import type { DiceSource } from './atlasDice';
import type { RollNotes } from './RollShare';
import type { TokenRules } from './tokenUI';
import type { MapSize } from './moveCheck';
import type { MoveStore } from './playerMoves';
import type { Timers } from './companionTimers';
import type { PlayedCharacter } from './book/characters';
import type { InitiativeSlice } from '../../stores/initiativeSlice';
import type { ConditionContext } from './PlayerConditions';
import type { DeferredResourceRequest } from './book/resourceWrites';

export interface AgencyRecipient {
  readonly scene: string;
  readonly mapPath: string;
  readonly map: MapSize | null;
  readonly lit: boolean;
  listedToken(alias: string): string | undefined;
  listedAlias(tokenId: string): string | undefined;
  shown(tokenId: string): boolean;
  listedDoor(alias: string): string | undefined;
  visibleDoor(wallId: string): boolean;
  listedCombatant(alias: string): string | undefined;
}

export interface SceneAgencyStore extends MoveStore {
  getState(): ViewState & Pick<InitiativeSlice, 'rollEntryInitiative' | 'nextTurn'>
    & Pick<ConditionContext, 'setTokensCondition' | 'changeTokensConditionValue'>
    & { toggleDoor(id: string): void };
}

export interface SceneAgencyPorts extends Timers {
  readonly ownership: Ownership;
  readonly doorNonces?: Map<string, Set<string>>;
  readonly log: TableLog;
  current(from: string): AgencyRecipient | null;
  tokenRules(): TokenRules;
  initiativeRules(): InitiativeRules;
  diceRules(): DiceRules | RollingDice;
  dice(): DiceSource | null;
  playedCharacter(from: string): PlayedCharacter | null;
  modifier(entry: InitiativeEntry): Promise<number | null>;
  templateDiceSet(character: PlayedCharacter): DiceSet | undefined;
  movementAllowed(from: string): boolean;
  actionAllowed(from: string): boolean;
  give(tokenIds: readonly string[], player: string): void;
  send(message: GmMessage, to?: string): void;
  refresh(from: string): void;
  refreshSheet(from: string): void;
  rollAs(from: string, run: () => void, notes: RollNotes): void;
  applyResource(request: DeferredResourceRequest): void;
  cancelResource(request: DeferredResourceRequest): void;
  resourcePlayerLeft(from: string): void;
  randomId(): string;
}

export interface SceneAgencyApi {
  receive(from: string, message: PlayerMessage): boolean;
  agency(from: string, scene: string, aliases: ReadonlyMap<string, string>): AgencyMessage;
}
