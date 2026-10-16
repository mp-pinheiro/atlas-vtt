import type { PlayerMessage, SharedScene } from '../protocol';
import type { ShownRollToken } from '../../services/playerRollSource';
import type { SceneStore } from './atlasView';
import type { AgencyRecipient } from './sceneAgencyTypes';
import type { SceneSharePorts } from './SceneShare';
import { MineShare } from './mineShare';
import { InputShare } from './InputShare';
import { LiveShare } from './LiveShare';
import { MapLayerShare } from './MapLayerShare';
import { MarkShare, type MarkSharePorts } from './MarkShare';
import { PlayerMoves } from './playerMoves';
import { RulesShare } from './RulesShare';
import { SceneDice } from './SceneDice';
import { TokenShare } from './TokenShare';
import { sceneWalls, type MapSize } from './moveCheck';
import { ownerIn } from './seatSource';

export interface PartyShareParts {
  readonly authority: ((from: string) => AgencyRecipient | null) | undefined;
  map(): MapSize | null;
  tokensChanged(): void;
  readonly recordGmMeasures: NonNullable<MarkSharePorts['recordGmMeasures']>;
  readonly recordPlayerMeasure: NonNullable<MarkSharePorts['recordPlayerMeasure']>;
}

export class PartyShare {
  readonly tokens: TokenShare;
  readonly inputs: InputShare;
  readonly layers: MapLayerShare;
  readonly moves: PlayerMoves;
  readonly dice: SceneDice;
  private readonly live: LiveShare | null;
  private readonly mine: MineShare | null;
  private readonly rules: RulesShare;
  private readonly marks: MarkShare;
  private scene: SharedScene | null = null;

  constructor(private readonly store: SceneStore, private readonly ports: SceneSharePorts, parts: PartyShareParts) {
    const seats = ports.seats;
    const ownerOf = ownerIn(seats, store);
    this.mine = seats === undefined ? null : new MineShare({ onlinePlayers: () => seats.onlinePlayers(), ownerOf }, (body, to) => ports.send(body, to));
    this.tokens = new TokenShare(store, ports, listed => { this.mine?.setList(listed); parts.tokensChanged(); });
    this.layers = new MapLayerShare(store, { ...ports, mapLayers: () => ports.mapLayers?.() ?? null });
    this.inputs = new InputShare(store, { ...ports, shownTokens: () => this.tokens.shownIds(), tokenAlias: id => this.tokens.alias(id), doorAlias: id => this.layers.doorAlias(id) });
    this.live = ports.sendLive === undefined ? null : new LiveShare(store, { ...ports, sendLive: (body, key) => ports.sendLive?.(body, key) }, () => ({ scene: this.tokens.listedScene, alias: id => this.tokens.listedAlias(id) }));
    const cursorsShown = (): boolean => ports.atlasSettings().showCursors;
    this.rules = new RulesShare(store, { ...ports, cursorsShown });
    this.moves = new PlayerMoves(store, { ...ports, context: from => {
      const scope = parts.authority?.(from);
      return { scene: parts.authority === undefined ? this.tokens.listedScene : scope?.scene ?? null,
        listedToken: alias => parts.authority === undefined ? this.tokens.listedToken(alias) : scope?.listedToken(alias),
        ownerOf, map: parts.map(), walls: sceneWalls(store.getState().objects.walls, this.scene?.lit === true, parts.map()) };
    } });
    this.marks = new MarkShare({ ...ports, cursorsShown, recordGmMeasures: parts.recordGmMeasures, recordPlayerMeasure: parts.recordPlayerMeasure }, () => parts.map());
    this.dice = new SceneDice(store, ports, { tokens: this.tokens, shownToken: (mapPath, id) => this.shownToken(mapPath, id), ...(parts.authority === undefined ? {} : { authority: parts.authority }) });
  }

  start(): void { this.moves.start(); this.dice.start(); }

  stop(): void {
    this.tokens.stop(); this.live?.stop(); this.inputs.stop(); this.layers.stop(); this.moves.stop(); this.dice.stop(); this.marks.stop(); this.rules.setScene(null);
  }

  setScene(scene: SharedScene | null): void {
    this.scene = scene;
    this.moves.sceneChanged();
    this.tokens.setScene(scene?.id ?? null);
    this.live?.setScene(scene);
    this.layers.setScene(scene);
    this.inputs.setScene(scene);
    this.rules.setScene(scene?.id ?? null);
    this.marks.setScene(scene?.id ?? null);
  }

  update(): void {
    this.marks.update(); this.tokens.update(); this.live?.update(); this.layers.update(); this.inputs.update(); this.rules.update();
  }

  resend(to?: string): void {
    this.tokens.resend(to); this.inputs.resend(to); this.layers.resend(to); this.rules.resend(to); this.mine?.resend(to); this.marks.resend(to);
  }

  ownersChanged(): void { this.tokens.update(); this.mine?.update(); }
  playerLeft(from: string): void { this.moves.playerLeft(from); this.marks.playerLeft(from); }

  receive(from: string, message: PlayerMessage): boolean {
    switch (message.t) {
      case 'move': this.moves.receive(from, message); return true;
      case 'drag': this.moves.drag(from, message); return true;
      case 'drag-cancel': this.moves.dragCancel(from, message); return true;
      case 'roll': this.dice.receive(from, message); return true;
      case 'laser': case 'measure': case 'cursor': this.marks.receive(from, message); return true;
      case 'resync': if (message.of === 'tokens') this.tokens.resync(from, message.scene); else this.inputs.resync(from, message.scene, message.of); return true;
      default: return false;
    }
  }

  shownToken(mapPath: string, id: string): ShownRollToken | null {
    if (this.tokens.listedScene === null || this.store.getState().mapPath !== mapPath) return null;
    return this.ports.tokenSource()?.playerRollTokens(mapPath, [id]).get(id) ?? null;
  }

  artPath(hash: string): string | undefined { return this.tokens.artPath(hash) ?? this.layers.artPath(hash); }
}
