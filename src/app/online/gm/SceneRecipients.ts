import type { AgencyMessage, GmMessage, SharedInitiative, SharedScene } from '../protocol';
import { resolveMeasurementSettings } from '../../grid/measurementFormat';
import { GENERIC_SIGHT_RULES } from '../../vision/sightRules';
import type { ShownRollToken } from '../../services/playerRollSource';
import { ArtRefs } from './artRefs';
import type { SceneState, SceneStore } from './atlasView';
import type { AgencyRecipient } from './sceneAgencyTypes';
import { InitiativeAliases, sharedInitiative } from './initiativeInputs';
import { sharedGrid } from './mapLayerInputs';
import type { MapLayerShare } from './MapLayerShare';
import { RecipientPicture, type RecipientView } from './RecipientPicture';
import { RecipientShare } from './RecipientShare';
import { sharedRules } from './RulesShare';
import type { SceneSharePorts } from './SceneShare';
import type { DeliveryValidity } from './sendQueue';
import type { MapSize } from './moveCheck';
import type { TokenShare } from './TokenShare';
import type { SceneAgency } from './SceneAgency';
import type { ReadablePin } from './pins/ReadablePins';
import { RecipientMarks } from './RecipientMarks';
import { tokenFootprints } from '../../vision/measureOrigin';

interface Recipient {
  readonly player: string;
  readonly scene: SharedScene;
  readonly share: RecipientShare | null;
  readonly combatants: InitiativeAliases;
  initiative: SharedInitiative | null;
  initiativeText: string | undefined;
  agencyText: string | undefined;
  art: ReadonlyMap<string, string>;
  view: RecipientView | null;
}

export class SceneRecipients {
  private base: SharedScene | null = null;
  private size: MapSize | null = null;
  private readonly recipients = new Map<string, Recipient>();
  private readonly picture = new RecipientPicture();
  private readonly art: ArtRefs;
  readonly marks: RecipientMarks;
  private generation = 0;
  private stopped = false;
  private updating = false;
  private again = false;
  private ownership = '';
  private adjusted: { readonly state: SceneState; readonly lit: boolean; readonly value: SceneState } | null = null;

  constructor(private readonly store: SceneStore, private readonly ports: SceneSharePorts, private readonly tokens: TokenShare, private readonly layers: MapLayerShare, private readonly actions: SceneAgency) {
    this.art = new ArtRefs(path => ports.readImage(path), () => this.update());
    this.marks = new RecipientMarks(player => this.recipients.get(player)?.view?.shown ?? null, () => {
      const source = ports.gmMarks?.();
      if (source != null) return source.footprints();
      const state = store.getState();
      return tokenFootprints(state.objects.tokens, Object.fromEntries(ports.drawnPlaces?.(Object.keys(state.objects.tokens)) ?? []), state.grid?.size ?? 0, state.tokenSettings?.tokenRingSize ?? 1);
    }, () => ports.now());
  }

  get personal(): boolean { return this.ports.permissions?.().perPlayerVision === true; }

  setScene(scene: SharedScene | null, size: MapSize | null): void {
    this.generation += 1;
    for (const entry of this.recipients.values()) entry.share?.stop();
    this.recipients.clear();
    this.picture.reset();
    this.art.clear();
    this.marks.reset();
    this.base = scene;
    this.size = size;
    this.adjusted = null;
    this.ownership = this.ownershipKey();
  }

  update(): void {
    if (this.stopped || this.base === null) return;
    if (this.updating) { this.again = true; return; }
    this.updating = true;
    try {
      do {
        this.again = false;
        this.project();
      } while (this.again && !this.stopped && this.base !== null);
    } finally { this.updating = false; }
  }

  ownersChanged(): boolean {
    const key = this.ownershipKey();
    const changed = key !== this.ownership;
    this.ownership = key;
    if (changed) {
      this.generation += 1;
      for (const entry of this.recipients.values()) {
        entry.share?.stop();
      }
      this.recipients.clear();
    }
    return changed;
  }

  resend(to?: string): void {
    this.update();
    const people = to === undefined ? this.ports.seats?.onlinePlayers() ?? [] : [to];
    for (const player of people) {
      const entry = this.recipients.get(player);
      if (this.personal) {
        if (entry?.share === null || entry === undefined) this.ports.send({ t: 'scene', scene: null }, player);
        else entry.share.resend();
      } else if (entry !== undefined) this.directives(entry, true);
    }
  }

  resync(from: string, scene: string): void { this.recipients.get(from)?.share?.resync(scene); }

  playerLeft(from: string): void {
    this.recipients.get(from)?.share?.stop();
    this.recipients.delete(from);
    this.marks.playerLeft(from);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.setScene(null, null);
  }

  current(from: string): AgencyRecipient | null {
    const state = this.store.getState();
    const base = this.base;
    if (this.stopped || base === null || state.mapPath === null || !state.mapLoaded || state.isMapLoading) return null;
    const entry = this.recipients.get(from);
    const share = entry?.share;
    const scene = this.personal ? share?.listedScene : this.tokens.listedScene;
    if (scene == null) return null;
    return {
      scene, mapPath: state.mapPath, map: this.size, lit: base.lit,
      listedToken: alias => share ? share.listedToken(alias) : this.tokens.listedToken(alias),
      listedAlias: id => share ? share.listedAlias(id) : this.tokens.listedAlias(id),
      shown: id => share ? share.tokenVisible(id) : this.tokens.shownIds()?.has(id) === true,
      listedDoor: alias => share ? share.doorId(alias) : this.layers.doorId(alias),
      visibleDoor: id => share ? entry?.view?.doors.has(id) === true : this.layers.doorVisible(id),
      listedCombatant: alias => entry?.initiative?.combatants.some(item => item.id === alias) ? entry.combatants.resolve(alias) : undefined,
    };
  }

  validity(from: string): DeliveryValidity {
    const generation = this.generation;
    const entry = this.recipients.get(from);
    const own = entry?.share?.validity();
    return { recipient: from, scene: entry?.scene.id ?? this.base?.id ?? '', generation, ...(own === undefined ? {} : { projection: own.projection }),
      valid: () => !this.stopped && generation === this.generation && this.base !== null && (!this.personal || entry !== undefined && this.recipients.get(from) === entry && own?.valid() === true),
    };
  }

  artPath(from: string, hash: string): string | undefined {
    const entry = this.recipients.get(from);
    return entry?.share?.artPath(hash) ?? entry?.art.get(hash);
  }

  readablePin(from: string, scene: string, alias: string): ReadablePin | null {
    return this.personal ? this.recipients.get(from)?.share?.readablePin(scene, alias) ?? null : this.layers.readablePin(scene, alias);
  }

  shownToken(from: string, mapPath: string, id: string): ShownRollToken | null {
    if (mapPath !== this.store.getState().mapPath) return null;
    return this.recipients.get(from)?.share?.shownToken(id) ?? null;
  }

  mapAllowed(from: string, hash: string): boolean {
    return !this.personal || this.recipients.get(from)?.scene.map?.hash === hash;
  }

  deliverShared(body: GmMessage, to?: string, liveKey?: string, validity?: DeliveryValidity): void {
    if (this.stopped) return;
    if (this.personal) {
      if (body.t === 'widgets' || body.t === 'marks' || body.t === 'roll') this.sendSide(body, to);
      return;
    }
    if (body.t === 'initiative') {
      const players = to === undefined || to === '*' ? this.ports.seats?.onlinePlayers() ?? [] : [to];
      for (const player of players) if (!this.isReady(player)) this.ports.send(body, player, this.validity(player));
      return;
    }
    const current = this.validity(to ?? '*');
    const guard: DeliveryValidity = { ...current, valid: () => current.valid() && validity?.valid() !== false };
    if (liveKey !== undefined && this.ports.sendLive !== undefined) this.ports.sendLive(body, liveKey, to, guard);
    else this.ports.send(body, to, guard);
  }

  rollOrigins(alias: string): Readonly<Record<string, string>> {
    let id = this.tokens.listedToken(alias);
    if (id === undefined) for (const entry of this.recipients.values()) {
      id = entry.share?.listedToken(alias);
      if (id !== undefined) break;
    }
    const origins: Record<string, string> = {};
    if (id !== undefined) for (const [player, entry] of this.recipients) {
      const token = entry.share?.listedAlias(id);
      if (token !== undefined) origins[player] = token;
    }
    return origins;
  }
  sendSide(body: GmMessage, to?: string): void {
    const players = to === undefined || to === '*' ? this.ports.seats?.onlinePlayers() ?? [] : [to];
    for (const player of players) {
      const entry = this.recipients.get(player);
      if (body.t === 'roll') {
        const token = body.token === null ? null : this.rollOrigins(body.token)[player] ?? null;
        const result = token === null && body.token !== null && body.result.source !== undefined
          ? { ...body.result, source: { type: body.result.source.type } } : body.result;
        this.ports.send(this.personal ? { ...body, token, result } : body, player);
      } else if (entry !== undefined && body.t === 'widgets') this.ports.send({ ...body, scene: entry.scene.id }, player, this.validity(player));
      else if (entry !== undefined && body.t === 'marks') this.ports.send({ ...this.marks.filter(player, body), scene: entry.scene.id }, player, this.validity(player));
      else if (!this.personal) this.ports.send(body, player);
    }
  }

  isReady(from: string): boolean { return this.ports.readyPlayers?.().includes(from) === true; }

  private project(): void {
    const base = this.base;
    const state = this.store.getState();
    if (base === null || !state.mapLoaded || state.isMapLoading) return;
    const source = this.ports.mapLayers?.() ?? null;
    const rules = sharedRules(state.grid, this.ports.measurement?.() ?? null, this.ports.accent?.() ?? null, this.ports.atlasSettings().showCursors);
    const personal = this.personal;
    const lighting = this.ports.lightingSource();
    const ready = this.ports.readyPlayers?.() ?? [];
    if (personal && this.size !== null && rules !== null) {
      let effective = state;
      if (state.lighting.enabled !== base.lit) {
        const cached = this.adjusted;
        effective = cached?.state === state && cached.lit === base.lit ? cached.value : { ...state, lighting: { ...state.lighting, enabled: base.lit } };
        this.adjusted = { state, lit: base.lit, value: effective };
      }
      this.picture.update(effective, { bounds: this.size, measurement: lighting?.measurement() ?? resolveMeasurementSettings(undefined, state.grid), rules: lighting?.rules() ?? GENERIC_SIGHT_RULES,
        ...(this.ports.drawnPlaces === undefined ? {} : { drawn: this.ports.drawnPlaces(Object.keys(state.objects.tokens)) }),
      });
    }
    for (const [player, entry] of this.recipients) if (!ready.includes(player)) { entry.share?.stop(); this.recipients.delete(player); }
    for (const player of ready) {
      let entry = this.recipients.get(player);
      if (entry === undefined) {
        const memoryId = personal ? this.ports.memoryId?.() : undefined;
        if (personal && (memoryId === undefined || rules === null || this.size === null)) { this.ports.send({ t: 'scene', scene: null }, player); continue; }
        const scene: SharedScene = personal ? { ...base, id: this.ports.randomId(), personal: true, memoryId: memoryId! } : base;
        const share = personal ? new RecipientShare(player, { randomId: () => this.ports.randomId(), now: () => this.ports.now(), readImage: path => this.ports.readImage(path),
          send: (body, recipient, validity) => this.ports.send(body, recipient, validity), changed: () => this.update(),
        }) : null;
        entry = { player, scene, share, combatants: new InitiativeAliases(), initiative: null, initiativeText: undefined, agencyText: undefined, art: new Map(), view: null };
        this.recipients.set(player, entry);
        share?.setScene(scene);
      }
      const art = new Map<string, string>();
      entry.initiative = sharedInitiative({ state, shown: this.ports.atlasSettings().showInitiative, showNames: this.ports.showNames(), rules: source?.rules() ?? null,
        ownerOf: id => this.ports.seats?.ownerOf(id, state.objects.tokens[id]), player, alias: id => entry.combatants.alias(id),
        turnKey: this.actions.turnKey(),
        art: path => { const ref = this.art.get(path); if (ref !== null) art.set(ref.hash, path); return ref; },
      });
      entry.art = art;
      if (personal && entry.share !== null && rules !== null) {
        const view = this.picture.project(player, token => this.ports.seats?.ownerOf(token.id, token));
        if (view === null) {
          if (entry.view !== null) { entry.share.setScene(null); this.ports.send({ t: 'scene', scene: null }, player); }
          entry.view = null;
          continue;
        }
        entry.view = view;
        entry.share.setScene(entry.scene);
        entry.share.update({ view, showNames: this.ports.showNames(), tokenRules: this.ports.tokenRules?.() ?? { resources: [], conditions: [] },
          grid: sharedGrid(source?.grid() ?? null), rules, initiative: entry.initiative, initiativeArt: art,
          ownerOf: token => this.ports.seats?.ownerOf(token.id, token), claimOf: (id, token) => this.ports.seats?.claimOf(state.mapPath ?? '', id, token) ?? null,
          agency: (scene, aliases) => this.agency(player, scene, aliases), foundPin: (map, pin) => this.ports.foundPin?.(map, pin) ?? null,
        });
        const marks = this.marks.recheck(player);
        if (marks !== null) this.ports.send({ ...marks, scene: entry.scene.id }, player, this.validity(player));
      } else this.directives(entry, false);
    }
  }

  private directives(entry: Recipient, force: boolean): void {
    const validity = this.validity(entry.player);
    const initiative = JSON.stringify(entry.initiative);
    if (force || initiative !== entry.initiativeText) { entry.initiativeText = initiative; this.ports.send({ t: 'initiative', scene: entry.scene.id, list: entry.initiative }, entry.player, validity); }
    const aliases = new Map<string, string>();
    for (const id of this.tokens.shownIds() ?? []) { const alias = this.tokens.listedAlias(id); if (alias !== undefined) aliases.set(id, alias); }
    const agency = this.agency(entry.player, entry.scene.id, aliases);
    const text = JSON.stringify(agency);
    if (force || text !== entry.agencyText) { entry.agencyText = text; this.ports.send(agency, entry.player, validity); }
  }

  private agency(from: string, scene: string, aliases: ReadonlyMap<string, string>): AgencyMessage {
    return this.actions.agency(from, scene, aliases);
  }

  private ownershipKey(): string {
    const state = this.store.getState();
    return JSON.stringify([this.personal, state.mapPath, Object.entries(state.objects.tokens).map(([id, token]) => [id, this.ports.seats?.ownerOf(id, token), this.ports.seats?.claimOf(state.mapPath ?? '', id, token)])]);
  }
}
