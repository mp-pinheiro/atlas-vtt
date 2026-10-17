import { deltaChanges, type AgencyMessage, type Claim, type GmMessage, type PictureMessage, type PicturePacket, type SharedGrid, type SharedInitiative, type SharedRules, type SharedScene } from '../protocol/index';
import { NO_INSTANCE_NUMBERS, type InstanceNumbers } from '../../vision/instanceNumbers';
import type { TokenEntity } from '../../types';
import type { ShownRollToken } from '../../services/playerRollSource';
import { wallList } from '../../vision/wallList';
import { ArtRefs } from './artRefs';
import { tokenLabel } from './atlasView';
import { sharedAnnotations, sharedDoors } from './mapLayerInputs';
import { ReadablePins, type ListedPin, type ReadablePin } from './pins/ReadablePins';
import type { RecipientView } from './RecipientPicture';
import { sharedFog, sharedLightingScene, sharedSight } from './sceneInputs';
import { sharedTokens, snapGridOf } from './scenePicture';
import { numberShownTokens, type TokenRules } from './tokenUI';
import type { VaultImage } from './TokenShare';

export interface RecipientValidity {
  readonly recipient: string;
  readonly scene: string;
  readonly projection: number;
  valid(): boolean;
}

export interface RecipientSharePorts {
  randomId(): string;
  now(): number;
  readImage(path: string): Promise<VaultImage | null>;
  send(body: GmMessage, to: string, validity: RecipientValidity): void;
  changed(): void;
}

export interface RecipientSnapshot {
  readonly view: RecipientView;
  readonly showNames: boolean;
  readonly tokenRules: TokenRules;
  readonly grid: SharedGrid | null;
  readonly rules: SharedRules;
  readonly initiative: SharedInitiative | null;
  readonly initiativeArt: ReadonlyMap<string, string>;
  ownerOf(token: TokenEntity): string | undefined;
  claimOf(id: string, token: TokenEntity): Claim;
  agency(scene: string, aliases: ReadonlyMap<string, string>): AgencyMessage;
  foundPin(mapPath: string, pinId: string): string | null;
}

type SequencedMessage = Extract<PictureMessage, { t: 'tokens' | 'fog' | 'sight' }>;
interface HeldChannel { readonly whole: PictureMessage; readonly text: string }

export class RecipientShare {
  private scene: SharedScene | null = null;
  private generation = 0;
  private projection = 0;
  private revision = 0;
  private readonly sequences = new Map<string, number>();
  private snapshot: RecipientSnapshot | null = null;
  private readonly aliases = new Map<string, string>();
  private readonly fogAliases = new Map<string, string>();
  private readonly lightAliases = new Map<string, string>();
  private readonly doorAliases = new Map<string, string>();
  private listed = new Map<string, string>();
  private artPaths = new Map<string, string>();
  private numbers: InstanceNumbers = NO_INSTANCE_NUMBERS;
  private readonly art: ArtRefs;
  private readonly pins: ReadablePins;
  private listedPins: readonly ListedPin[] = [];
  private readonly channels = new Map<string, HeldChannel>();
  private lastInitiative: string | null = null;
  private live: Extract<PictureMessage, { t: 'live' }> | null = null;

  constructor(readonly player: string, private readonly ports: RecipientSharePorts) {
    this.art = new ArtRefs(path => ports.readImage(path), () => ports.changed());
    this.pins = new ReadablePins(() => ports.randomId());
  }

  setScene(scene: SharedScene | null): void {
    if (scene?.id === this.scene?.id) return;
    this.generation += 1;
    this.projection += 1;
    this.scene = scene;
    this.snapshot = null;
    this.revision = 0;
    this.channels.clear();
    this.sequences.clear();
    this.aliases.clear();
    this.fogAliases.clear();
    this.lightAliases.clear();
    this.doorAliases.clear();
    this.listed.clear();
    this.artPaths.clear();
    this.numbers = NO_INSTANCE_NUMBERS;
    this.art.clear();
    this.pins.clear();
    this.listedPins = [];
    this.lastInitiative = null;
    this.live = null;
    if (scene !== null) this.send({ t: 'scene', scene });
  }

  update(snapshot: RecipientSnapshot): void {
    const scene = this.scene;
    if (scene === null || !snapshot.view.state.mapLoaded || snapshot.view.state.isMapLoading) return;
    const previous = this.snapshot;
    const previousArt = this.artPaths;
    this.snapshot = snapshot;
    const messages = this.build(snapshot, scene.id);
    const authorityChanged = previous !== null && (
      [...previous.view.shown].some(id => !snapshot.view.shown.has(id)) ||
      [...previous.view.sourceIds].some(id => !snapshot.view.sourceIds.has(id)) ||
      [...previousArt.keys()].some(hash => !this.artPaths.has(hash))
    );
    if (authorityChanged) {
      this.projection += 1;
      this.send({ t: 'scene', scene });
    }
    const changed = messages.some(message => this.channels.get(message.t)?.text !== JSON.stringify(message));
    if (changed || authorityChanged) this.publish(messages, this.revision === 0 || authorityChanged);
    const initiative = JSON.stringify(snapshot.initiative);
    if (initiative !== this.lastInitiative || authorityChanged) {
      this.lastInitiative = initiative;
      this.send({ t: 'initiative', scene: scene.id, list: snapshot.initiative });
    }
  }

  resend(): void {
    if (this.scene === null || this.snapshot === null) return;
    this.send({ t: 'scene', scene: this.scene });
    this.publish(this.build(this.snapshot, this.scene.id), true);
    this.send({ t: 'initiative', scene: this.scene.id, list: this.snapshot.initiative });
  }

  resync(scene: string): void {
    if (scene === this.scene?.id && this.snapshot !== null) this.publish(this.build(this.snapshot, scene), true);
  }

  invalidate(): void {
    this.projection += 1;
    this.revision = 0;
    this.snapshot = null;
    this.listed.clear();
    this.artPaths.clear();
    this.channels.clear();
    this.live = null;
  }

  stop(): void { this.setScene(null); }
  get listedScene(): string | null { return this.snapshot === null ? null : this.scene?.id ?? null; }
  listedToken(alias: string): string | undefined { return this.listed.get(alias); }
  listedAlias(id: string): string | undefined {
    const alias = this.aliases.get(id);
    return alias !== undefined && this.listed.has(alias) ? alias : undefined;
  }
  shownIds(): ReadonlySet<string> | null { return this.snapshot?.view.shown ?? null; }
  artPath(hash: string): string | undefined { return this.artPaths.get(hash); }
  doorId(alias: string): string | undefined {
    for (const [id, value] of this.doorAliases) if (value === alias && this.snapshot?.view.doors.has(id)) return id;
    return undefined;
  }
  readablePin(scene: string, alias: string): ReadablePin | null {
    if (this.scene?.id !== scene || this.snapshot === null) return null;
    const pin = this.listedPins.find(entry => entry.alias === alias);
    const map = this.snapshot.view.state.mapPath;
    return pin === undefined || map === null ? null : { ...pin, map };
  }
  tokenVisible(id: string): boolean { return this.snapshot?.view.shown.has(id) === true; }

  shownToken(id: string): ShownRollToken | null {
    const snapshot = this.snapshot;
    if (snapshot === null || !snapshot.view.shown.has(id)) return null;
    const token = snapshot.view.state.objects.tokens[id];
    return token === undefined ? null : {
      name: tokenLabel(token), imagePath: token.imagePath,
      showRing: token.showRing !== false, ringColor: token.ringColor,
    };
  }

  validity(): RecipientValidity {
    const generation = this.generation;
    const projection = this.projection;
    return {
      recipient: this.player, scene: this.scene?.id ?? '', projection,
      valid: (): boolean => this.scene !== null && generation === this.generation && projection === this.projection,
    };
  }

  private alias(map: Map<string, string>, id: string): string {
    let alias = map.get(id);
    if (alias === undefined) { alias = this.ports.randomId(); map.set(id, alias); }
    return alias;
  }

  private build(snapshot: RecipientSnapshot, scene: string): PictureMessage[] {
    const { view } = snapshot;
    const { state } = view;
    const art = new Map(snapshot.initiativeArt);
    const badges = numberShownTokens(this.numbers, state.objects.tokens, id => view.shown.has(id), state.tokenSettings?.showInstanceBadges ?? true);
    this.numbers = badges.numbers;
    const shown = new Map([...view.shown].flatMap(id => {
      const token = state.objects.tokens[id];
      return token === undefined ? [] : [[id, { name: tokenLabel(token), imagePath: token.imagePath, showRing: token.showRing !== false, ringColor: token.ringColor }] as const];
    }));
    const idsByAlias = new Map<string, string>();
    const tokens = sharedTokens({ tokens: state.objects.tokens, shown, gridSize: snapshot.rules.grid.size, showNames: snapshot.showNames, rules: snapshot.tokenRules, claimOf: (id, token) => snapshot.claimOf(id, token),
      badge: id => badges.badge(id), alias: id => {
        const alias = this.alias(this.aliases, id);
        idsByAlias.set(alias, id);
        return alias;
      }, art: path => {
        const ref = this.art.get(path);
        if (ref !== null) art.set(ref.hash, path);
        return ref;
      },
    });
    this.listed = new Map(tokens.flatMap(token => {
      const id = idsByAlias.get(token.id);
      return id === undefined ? [] : [[token.id, id] as const];
    }));
    this.artPaths = art;
    const aliases = new Map([...this.listed].map(([alias, id]) => [id, alias]));
    this.listedPins = this.pins.listed(state, { lit: state.lighting.enabled, fog: view.fog, seen: points => view.pointsSeen(points) }) ?? [];
    const lighting = sharedLightingScene(state, view.rules, view.measurement);
    const walls = wallList(state.objects.walls);
    const doors = sharedDoors(state.objects.walls, view.doors, id => this.alias(this.doorAliases, id));
    const sharedWalls = lighting.walls.map((wall, index) => {
      const original = walls[index];
      return original?.type === 'door' ? { ...wall, id: this.alias(this.doorAliases, original.id) } : wall;
    });
    const sight = sharedSight({ state, rules: view.rules, shown: view.shown, policy: view.policy, tokenAlias: id => this.alias(this.aliases, id), lightAlias: id => this.alias(this.lightAliases, id) });
    const live = tokens.flatMap(token => {
      const id = this.listed.get(token.id);
      const at = id === undefined ? undefined : view.drawn.get(id);
      return at === undefined ? [] : [{ id: token.id, x: at.x, y: at.y }];
    });
    if (this.live === null || this.live.tokens.length !== live.length || live.some((token, index) => {
      const previous = this.live?.tokens[index];
      return previous?.id !== token.id || previous.x !== token.x || previous.y !== token.y;
    })) this.live = { t: 'live', scene, at: this.ports.now(), tokens: live };
    const sensed = [...view.sensed].flatMap(id => {
      const token = state.objects.tokens[id];
      const at = view.drawn.get(id) ?? token;
      return token === undefined || at === undefined ? [] : [{ x: at.x, y: at.y, size: (token.size ?? 1) * snapshot.rules.grid.size }];
    });
    const own = tokens.filter(token => {
      const id = this.listed.get(token.id);
      return id !== undefined && snapshot.ownerOf(state.objects.tokens[id]!) === this.player;
    }).map(token => token.id);
    return [
      { t: 'tokens', scene, tokens, cell: snapshot.rules.grid.size, snap: snapGridOf(state.grid) },
      { t: 'fog', scene, fog: sharedFog(state.objects.fog, id => this.alias(this.fogAliases, id)) },
      { t: 'sight', scene, ...sight }, { t: 'lighting', scene, ...lighting, walls: sharedWalls },
      { t: 'mine', scene, tokens: own }, { t: 'grid', scene, grid: snapshot.grid },
      { t: 'doors', scene, doors }, { t: 'sensed', scene, tokens: sensed },
      { t: 'pins', scene, pins: this.pins.shared(this.listedPins, id => snapshot.foundPin(state.mapPath ?? '', id)) },
      { t: 'annotations', scene, ...sharedAnnotations(state.objects.drawings, state.objects.texts, view.fog) },
      { t: 'rules', scene, ...snapshot.rules }, snapshot.agency(scene, aliases),
      this.live,
    ];
  }

  private publish(messages: readonly PictureMessage[], whole: boolean): void {
    const scene = this.scene;
    if (scene === null) return;
    const selected: PictureMessage[] = [];
    for (const message of messages) {
      const text = JSON.stringify(message);
      const previous = this.channels.get(message.t);
      if (!whole && previous?.text === text) continue;
      let sent = message;
      if (message.t === 'tokens' || message.t === 'fog' || message.t === 'sight') {
        const { t, scene: id, seq: _seq, ...content } = message;
        const seq = (this.sequences.get(t) ?? 0) + 1;
        this.sequences.set(t, seq);
        sent = { ...message, seq };
        if (!whole && previous !== undefined) {
          const before = previous.whole as SequencedMessage;
          const { t: _t, scene: _scene, seq: _oldSeq, ...old } = before;
          const changes = deltaChanges(t, old, content);
          const delta: PictureMessage | null = changes === null ? null : { t: 'delta', of: t, scene: id, seq, ...changes };
          if (delta !== null && JSON.stringify(delta).length < text.length) selected.push(delta);
          else selected.push(sent);
        } else selected.push(sent);
      } else selected.push(sent);
      this.channels.set(message.t, { whole: sent, text });
    }
    if (!whole && selected.length === 0) return;
    const packet: PicturePacket = { t: 'picture', scene: scene.id, revision: ++this.revision, whole, messages: selected };
    this.send(packet);
  }

  private send(body: GmMessage): void { this.ports.send(body, this.player, this.validity()); }
}
