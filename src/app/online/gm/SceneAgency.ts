import { MAX_TOKEN_VALUE, parseAgencyResponse, type AgencyMessage, type PlayerMessage } from '../protocol';
import { conditionEffect } from '../../gameSystems/conditionEffects';
import { t } from '../../i18n';
import type { InitiativeEntry } from '../../types/initiativeTypes';
import type { InitiativeRollResult } from '../../initiative/initiativeRoll';
import { ClaimRequests } from './claims';
import { PlayerConditions, playerConditionValues } from './PlayerConditions';
import { PlayerInitiative } from './PlayerInitiative';
import { PendingPaths } from './PendingPaths';
import { PlayerDoors } from './PlayerDoors';
import { DeferredSceneWrites, type DeferredSceneRequest, type DeferredCancelReason } from './DeferredSceneWrites';
import { SheetRolls, type SheetAuthority } from './book/SheetRolls';
import type { DeferredResourceRequest } from './book/resourceWrites';
import { sceneWalls, type MoveContext } from './moveCheck';
import { tokenLabel } from './atlasView';
import type { AgencyRecipient, SceneAgencyApi, SceneAgencyPorts, SceneAgencyStore } from './sceneAgencyTypes';
import { sharedRoll } from './RollShare';

export type { AgencyRecipient, SceneAgencyPorts, SceneAgencyStore } from './sceneAgencyTypes';

export class SceneAgency implements SceneAgencyApi {
  readonly claims: ClaimRequests;
  readonly paths: PendingPaths;
  readonly writes: DeferredSceneWrites;
  readonly initiative: PlayerInitiative;
  private readonly doors: PlayerDoors;
  private readonly sheets: SheetRolls;
  private readonly conditions = new Map<string, PlayerConditions>();
  private readonly unsubscribe: () => void;
  private stopped = false;

  constructor(private readonly store: SceneAgencyStore, private readonly ports: SceneAgencyPorts) {
    this.writes = new DeferredSceneWrites(store, {
      setTimer: (run, ms) => ports.setTimer(run, ms), clearTimer: timer => ports.clearTimer(timer),
      apply: request => this.apply(request), cancel: (request, reason) => this.cancel(request, reason),
    });
    this.claims = new ClaimRequests({ ownership: ports.ownership, log: ports.log,
      current: from => {
        const current = this.current(from);
        return current === null ? null : { ...current, tokens: store.getState().objects.tokens,
          tokenId: alias => this.listed(from, alias), shown: id => current.shown(id) };
      }, give: (id, from) => ports.give([id], from), send: (message, to) => ports.send(message, to),
    });
    this.paths = new PendingPaths(store, {
      context: from => this.moveContext(from), approval: () => this.permissions().approval,
      online: from => this.online(from), movementAllowed: from => ports.movementAllowed(from),
      defer: request => this.writes.enqueue(request), send: (message, to) => ports.send(message, to),
      now: () => ports.now(), setTimer: (run, ms) => ports.setTimer(run, ms), clearTimer: timer => ports.clearTimer(timer),
      reminder: path => { ports.log.action('approval-reminder', { player: ports.ownership.nameOf(path.from), combatant: tokenLabel(path.token), count: 1 }, 'gm'); },
    });
    this.doors = new PlayerDoors(store, {
      nonces: ports.doorNonces,
      context: from => {
        const current = this.current(from), state = store.getState();
        return { scene: current?.scene ?? null, enabled: current !== null && ports.ownership.permissionsFor(current.mapPath).playerDoors,
          lit: current?.lit === true, gridSize: state.grid?.size ?? 0, walls: state.objects.walls, tokens: state.objects.tokens,
          listedDoor: alias => current?.listedDoor(alias), listedToken: id => current?.listedAlias(id) !== undefined && current.shown(id),
          ownerOf: id => this.ownerOf(id), visibleDoor: id => current?.visibleDoor(id) === true };
      }, movementAllowed: from => ports.movementAllowed(from), defer: request => this.writes.enqueue(request), send: (message, to) => ports.send(message, to),
    });
    this.initiative = new PlayerInitiative({
      context: from => {
        const current = this.current(from), state = store.getState();
        return { scene: current?.scene ?? null, initiative: state.initiative, trackerOpen: state.initiativeTrackerOpen,
          rules: ports.initiativeRules(), tokens: state.objects.tokens,
          listedCombatant: alias => current?.listedCombatant(alias), ownerOf: id => this.ownerOf(id) };
      }, online: from => this.online(from), actionAllowed: from => ports.actionAllowed(from), diceAvailable: () => ports.dice() !== null,
      modifier: entry => ports.modifier(entry), defer: (from, message) => message.t === 'end-turn'
        ? this.writes.enqueue({ kind: 'end-turn', from, message }) : this.writes.enqueue({ kind: 'initiative-roll', from, message }),
      actions: () => store.getState(), send: (message, to) => ports.send(message, to), refresh: from => ports.refresh(from),
      rolled: (from, entry, result) => this.rolled(from, entry, result),
      turnEnded: (from, entry) => { ports.log.action('turn-ended', { player: ports.ownership.nameOf(from), combatant: entry.name, count: null }, '*'); },
    });
    this.sheets = new SheetRolls({ current: from => this.sheetAuthority(from), dice: () => ports.dice(),
      actionAllowed: from => ports.actionAllowed(from), defer: request => this.writes.enqueue(request),
      send: (message, to) => ports.send(message, to), refresh: from => ports.refreshSheet(from),
      rollAs: (from, run, notes) => ports.rollAs(from, run, notes), logged: roll => { ports.log.rolled(roll); }, randomId: () => ports.randomId(),
    });
    this.unsubscribe = ports.ownership.onChange(() => this.ownersChanged());
  }

  receive(from: string, message: PlayerMessage): boolean {
    if (this.stopped) return false;
    switch (message.t) {
      case 'claim-request': this.claims.receive(from, message); return true;
      case 'condition': this.conditionHandler(from).receive(from, message); return true;
      case 'initiative-roll': case 'end-turn': this.initiative.receive(from, message); return true;
      case 'path': case 'path-cancel': this.paths.receive(from, message); return true;
      case 'door': this.doors.receive(from, message); return true;
      case 'sheet-roll': this.sheets.receive(from, message); return true;
      default: return false;
    }
  }

  agency(from: string, scene: string, aliases: ReadonlyMap<string, string>): AgencyMessage {
    const state = this.store.getState();
    const permissions = this.online(from) && state.mapLoaded && !state.isMapLoading ? this.permissions() : this.permissions(null);
    const conditions: AgencyMessage['conditions'][number][] = [];
    const definitions = permissions.playerConditions ? this.ports.tokenRules().conditions.filter(def => conditionEffect(def) === undefined) : [];
    for (const def of definitions) {
      if (conditions.length >= 256 || conditions.some(value => value.id === def.id)) continue;
      const candidate = { id: def.id, name: def.name, valued: def.valued === true, colour: def.color, ...(def.icon === undefined ? {} : { icon: def.icon }) };
      if (parseAgencyResponse({ t: 'agency', scene, permissions, conditions: [candidate], values: {} }) !== null) conditions.push(candidate);
    }
    const allowed = new Set(conditions.map(def => def.id));
    const own = new Map([...aliases].filter(([id]) => this.ownerOf(id) === from));
    const values = playerConditionValues(this.store.getState().objects.tokens, own, definitions.filter(def => allowed.has(def.id)));
    for (const record of Object.values(values)) for (const [id, value] of Object.entries(record)) {
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_VALUE) delete record[id];
    }
    return { t: 'agency', scene, permissions, conditions, values };
  }

  deferredResource(request: DeferredResourceRequest): boolean { return this.writes.enqueue(request); }
  turnKey(): string | null {
    const initiative = this.store.getState().initiative;
    return initiative === undefined ? null : this.initiative.turnKey(initiative);
  }
  ownersChanged(): void { if (!this.stopped) { this.claims.update(); this.paths.reconcile(); } }
  playerLeft(from: string): void {
    this.writes.clearPlayer(from); this.claims.playerLeft(from); this.paths.playerLeft(from);
    this.initiative.playerLeft(from); this.doors.playerLeft(from); this.conditions.delete(from); this.ports.resourcePlayerLeft(from);
  }
  sceneChanged(): void {
    this.writes.clear(); this.claims.sceneChanged(); this.paths.sceneChanged(); this.initiative.sceneChanged(); this.doors.sceneChanged(); this.conditions.clear();
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.unsubscribe(); this.writes.stop(); this.claims.stop(); this.paths.stop(); this.initiative.stop(); this.doors.stop(); this.conditions.clear();
  }

  private current(from: string): AgencyRecipient | null {
    const state = this.store.getState();
    if (this.stopped || !state.mapLoaded || state.isMapLoading || !this.online(from)) return null;
    const current = this.ports.current(from);
    return current !== null && current.mapPath === state.mapPath ? current : null;
  }
  private online(from: string): boolean { return this.ports.ownership.list().some(player => player.id === from && player.online); }
  private ownerOf(id: string): string | undefined { return this.ports.ownership.ownerOf(id, this.store.getState().objects.tokens[id]); }
  private listed(from: string, alias: string): string | undefined {
    const current = this.current(from), id = current?.listedToken(alias);
    return id !== undefined && current?.shown(id) ? id : undefined;
  }
  private permissions(mapPath: string | null = this.store.getState().mapPath): AgencyMessage['permissions'] {
    return mapPath === null ? { approval: false, perPlayerVision: false, playerConditions: false, playerDoors: false } : this.ports.ownership.permissionsFor(mapPath);
  }
  private moveContext(from: string): MoveContext {
    const current = this.current(from), state = this.store.getState();
    return { scene: current?.scene ?? null, tokens: state.objects.tokens, map: current?.map ?? null,
      walls: sceneWalls(state.objects.walls, current?.lit === true, current?.map ?? null),
      listedToken: alias => this.listed(from, alias), ownerOf: id => this.ownerOf(id) };
  }
  private conditionHandler(from: string): PlayerConditions {
    const previous = this.conditions.get(from);
    if (previous !== undefined) return previous;
    const handler = new PlayerConditions({
      context: () => {
        const current = this.current(from), state = this.store.getState();
        return { scene: current?.scene ?? null, enabled: current !== null && this.ports.ownership.permissionsFor(current.mapPath).playerConditions,
          tokens: state.objects.tokens, conditions: this.ports.tokenRules().conditions, listedToken: (player, alias) => this.listed(player, alias),
          ownerOf: id => this.ownerOf(id), online: player => this.online(player),
          setTokensCondition: (ids, id, active) => this.store.getState().setTokensCondition(ids, id, active),
          changeTokensConditionValue: (ids, id, delta) => this.store.getState().changeTokensConditionValue(ids, id, delta) };
      }, movementAllowed: player => this.ports.movementAllowed(player), defer: request => this.writes.enqueue(request), refresh: player => this.ports.refresh(player),
    });
    this.conditions.set(from, handler);
    return handler;
  }
  private sheetAuthority(from: string): SheetAuthority | null {
    const current = this.current(from);
    if (current === null) return null;
    const character = this.ports.playedCharacter(from);
    if (character === null || character.mapPath !== current.mapPath || character.sheet.statblock == null) return null;
    const token = this.store.getState().objects.tokens[character.tokenId], alias = current.listedAlias(character.tokenId);
    if (token === undefined || token.kind !== 'character' || token.isHidden || this.ownerOf(character.tokenId) !== from || !current.shown(character.tokenId) || alias === undefined || !token.statblockPath) return null;
    return { sheet: character.sheet.statblock, character: JSON.stringify([character.collection, character.key]), scene: current.scene,
      mapPath: current.mapPath, tokenId: token.id, tokenAlias: alias, sourcePath: token.statblockPath,
      set: this.ports.templateDiceSet(character), rules: this.ports.diceRules() };
  }
  private rolled(from: string, entry: InitiativeEntry, result: InitiativeRollResult): void {
    const roll = sharedRoll({ ...result, id: this.ports.randomId(), timestamp: this.ports.now(), source: { type: 'statblock', abilityName: t('initiative.total') } });
    this.ports.log.rolled({ who: from, roll, token: null, shared: true, flavor: `${entry.name} · ${t('initiative.total')}` });
    this.ports.send({ t: 'roll', who: from, result: roll, token: null });
  }
  private apply(request: DeferredSceneRequest): void {
    switch (request.kind) {
      case 'condition': this.conditionHandler(request.from).apply(request.from, request.message); return;
      case 'end-turn': case 'initiative-roll': this.initiative.apply(request.from, request.message); return;
      case 'door': this.doors.apply(request.from, request.message); return;
      case 'sheet-roll': this.sheets.apply(request.from, request.message); return;
      case 'approval': this.paths.apply(request.from, request); return;
      case 'resource': this.ports.applyResource(request); return;
    }
  }
  private cancel(request: DeferredSceneRequest, reason: DeferredCancelReason): void {
    switch (request.kind) {
      case 'condition': if (reason !== 'replaced') this.ports.refresh(request.from); return;
      case 'end-turn': case 'initiative-roll': this.initiative.cancel(request.from, request.message); return;
      case 'door': this.doors.cancel(request.from, request.message); return;
      case 'sheet-roll': this.ports.send({ t: 'roll-refused', reason: 'unavailable' }, request.from); this.ports.refresh(request.from); return;
      case 'approval': this.paths.cancelApproval(request); return;
      case 'resource': this.ports.cancelResource(request); return;
    }
  }
}
