import { MAX_ASSET_BYTES, parsePlayerMessage, type AssetRef, type GmMessage, type RollRequestAnswer, type ScenePermissions, type SharedScene } from '../protocol/index.ts';
import { headerOf } from '../../imageProcessing/imageDimensions';
import type { DiceSource } from './atlasDice.ts';
import { isLit, LIGHTING_REFUSAL, type AtlasPlayerSettings, type LightingSource } from './atlasLighting.ts';
import type { SceneState, SceneStore } from './atlasView.ts';
import { AssetAnswers } from './assetAnswers.ts';
import { imageMimeType, REPEAT_REQUEST_MS, sha256Hex } from './assetServe.ts';
import type { ScaleImage } from './assetVariants.ts';
import type { LoggedRoll, RollRequest } from './log/TableLog.ts';
import type { SceneDice } from './SceneDice.ts';
import type { MapLayerShare } from './MapLayerShare.ts';
import type { MapLayerSource } from './atlasMapLayers.ts';
import type { MarkSharePorts } from './MarkShare.ts';
import type { MapSize } from './moveCheck.ts';
import type { SeatSource } from './seatSource.ts';
import type { RulesSharePorts } from './RulesShare.ts';
import { TOKEN_POLL_MS, type TokenSharePorts } from './TokenShare.ts';
import { PartyShare } from './PartyShare';
import { SceneRecipients } from './SceneRecipients';
import type { SceneAgency } from './SceneAgency';
import type { AgencyRecipient } from './sceneAgencyTypes';
import type { DeliveryValidity } from './sendQueue';
import type { ReadablePin } from './pins/ReadablePins';

export { imageMimeType, isLit, LIGHTING_REFUSAL, REPEAT_REQUEST_MS };

export interface SceneSharePorts extends TokenSharePorts, RulesSharePorts, Pick<MarkSharePorts, 'gmMarks' | 'showPlayerMarks' | 'showPlayerCursors' | 'nameOf' | 'playerColour'> {
  notice(text: string): void;
  actionAllowed(from: string): boolean;
  movementAllowed(from: string): boolean;
  send(body: GmMessage, to?: string, validity?: DeliveryValidity): void;
  sendLive?(body: GmMessage, key: string, to?: string, validity?: DeliveryValidity): void;
  drawnPlaces?(tokenIds: readonly string[]): ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  seats?: SeatSource | undefined;
  lightingSource(): LightingSource | null;
  atlasSettings(): AtlasPlayerSettings;
  dice?(): DiceSource | null;
  mapLayers?(): MapLayerSource | null;
  scaleImage?: ScaleImage;
  logRoll?(roll: LoggedRoll): void;
  logArt?(hash: string, from: string): string | undefined;
  rollRequest?(from: string, answer: RollRequestAnswer): RollRequest | null;
  foundPin?(mapPath: string, pinId: string): string | null;
  readonly agency?: SceneAgency;
  permissions?(): ScenePermissions;
  readyPlayers?(): readonly string[];
  memoryId?(): string | undefined;
  held?(): boolean;
}

interface BuiltScene {
  readonly map: AssetRef | null;
  readonly bytes: Uint8Array<ArrayBuffer> | null;
  readonly size: MapSize | null;
}

export class SceneShare {
  readonly layers: MapLayerShare;
  readonly dice: SceneDice;
  readonly agency: SceneAgency | null;
  private scene: SharedScene | null = null;
  private mapBytes: Uint8Array<ArrayBuffer> | null = null;
  private mapSize: MapSize | null = null;
  private key: string | null = null;
  private generation = 0;
  private delivery = 0;
  private stopped = false;
  private refusal: string | null = null;
  private personal = false;
  private approval = false;
  private readonly assets: AssetAnswers;
  private readonly party: PartyShare;
  private readonly recipients: SceneRecipients | null;
  private unsubscribe: (() => void) | null = null;
  private poll: number | undefined;

  constructor(private readonly store: SceneStore, private readonly ports: SceneSharePorts) {
    this.agency = ports.agency ?? null;
    this.personal = ports.permissions?.().perPlayerVision === true;
    this.approval = ports.permissions?.().approval === true;
    const shared: SceneSharePorts = { ...ports, send: (body, to, validity) => this.deliverShared(body, to, undefined, validity),
      logRoll: roll => ports.logRoll?.(this.personal && roll.token !== null ? { ...roll, origins: this.recipients?.rollOrigins(roll.token) ?? {} } : roll),
      ...(ports.sendLive === undefined ? {} : { sendLive: (body: GmMessage, key: string, to?: string, validity?: DeliveryValidity): void => this.deliverShared(body, to, key, validity) }),
    };
    this.party = new PartyShare(store, shared, { authority: this.agency === null ? undefined : from => this.authority(from), map: () => this.mapSize,
      tokensChanged: () => this.recipients?.update(),
      recordGmMeasures: (records, press) => this.recipients?.marks.recordGm(records, press),
      recordPlayerMeasure: (from, state) => this.recipients?.marks.recordPlayer(from, state),
    });
    this.layers = this.party.layers;
    this.dice = this.party.dice;
    this.recipients = this.agency === null ? null : new SceneRecipients(store, ports, this.party.tokens, this.layers, this.agency);
    this.assets = new AssetAnswers({ send: (body, to, valid) => ports.send(body, to, this.assetValidity(to, valid)), now: () => ports.now(), readImage: path => ports.readImage(path), scaleImage: ports.scaleImage }, {
      map: from => {
        const map = this.scene?.map;
        return map !== undefined && map !== null && this.mapBytes !== null && (this.recipients?.mapAllowed(from, map.hash) ?? true) ? { hash: map.hash, bytes: this.mapBytes, mime: map.mime } : null;
      },
      explored: hash => this.personal ? undefined : this.party.inputs.exploredBytes(hash),
      artPath: (hash, from) => this.artPath(hash, from),
      validity: from => () => this.assetValidity(from).valid(),
    });
  }

  start(): void {
    if (this.stopped || this.unsubscribe !== null) return;
    this.unsubscribe = this.store.subscribe(state => void this.update(state));
    void this.update(this.store.getState());
    this.schedulePoll();
    this.party.start();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.delivery += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.poll !== undefined) this.ports.clearTimer(this.poll);
    this.poll = undefined;
    this.assets.forget();
    this.agency?.stop();
    this.recipients?.stop();
    this.party.stop();
    this.scene = null;
    this.mapBytes = null;
    this.mapSize = null;
  }

  resend(to?: string): void {
    if (this.stopped) return;
    if (to === undefined) this.assets.forget();
    if (!this.personal) {
      this.ports.send({ t: 'scene', scene: this.scene }, to, this.assetValidity(to ?? '*'));
      this.party.resend(to);
    } else if (this.scene === null) this.ports.send({ t: 'scene', scene: null }, to);
    this.recipients?.resend(to);
    if (this.personal) this.party.resend(to);
  }

  ownersChanged(): void {
    if (this.stopped) return;
    const personal = this.ports.permissions?.().perPlayerVision === true;
    const approval = this.ports.permissions?.().approval === true;
    if (approval && !this.approval) this.party.moves.sceneChanged();
    this.approval = approval;
    const modeChanged = personal !== this.personal;
    const invalidated = this.recipients?.ownersChanged() === true;
    this.personal = personal;
    if (modeChanged || invalidated) {
      this.delivery += 1;
      this.assets.forget();
      this.ports.send({ t: 'scene', scene: null });
      if (this.scene !== null) this.publish({ ...this.scene, id: this.ports.randomId() }, this.mapBytes, this.mapSize);
      else this.agency?.sceneChanged();
      return;
    }
    this.party.ownersChanged();
    this.agency?.ownersChanged();
    this.recipients?.update();
  }

  playerLeft(from: string): void {
    this.party.playerLeft(from);
    this.agency?.playerLeft(from);
    this.recipients?.playerLeft(from);
    this.assets.forget(from);
  }

  authority(from: string): AgencyRecipient | null { return this.recipients?.current(from) ?? null; }
  readablePin(from: string, scene: string, alias: string): ReadablePin | null { return this.recipients === null ? this.layers.readablePin(scene, alias) : this.recipients.readablePin(from, scene, alias); }

  pinsChanged(): void {
    this.layers.update();
    this.recipients?.update();
  }

  sendTable(body: GmMessage, to?: string): void {
    if (this.stopped) return;
    if (this.personal && body.t === 'roll') this.recipients?.sendSide(body, to);
    else this.ports.send(body, to);
  }

  withdraw(): void {
    if (this.stopped) return;
    this.generation += 1;
    this.key = null;
    this.publish(null, null);
  }

  receive(from: string, body: unknown): void {
    if (this.stopped) return;
    const message = parsePlayerMessage(body);
    if (message === null) return;
    if (this.agency?.receive(from, message)) return;
    if (message.t === 'picture-resync') return this.recipients?.resync(from, message.scene);
    if (message.t === 'asset-request') { this.assets.answer(from, message); return; }
    if (this.approval && (message.t === 'move' || message.t === 'drag' || message.t === 'drag-cancel')) {
      this.ports.movementAllowed(from);
      return this.party.moves.refuse(from, message);
    }
    if (this.personal && message.t === 'resync') return this.recipients?.resync(from, message.scene);
    if (this.personal && (message.t === 'laser' || message.t === 'measure' || message.t === 'cursor')) {
      if (this.authority(from)?.scene !== message.scene || this.scene === null) return;
      this.party.receive(from, { ...message, scene: this.scene.id });
    } else this.party.receive(from, message);
  }

  private deliverShared(body: GmMessage, to?: string, liveKey?: string, validity?: DeliveryValidity): void {
    if (this.stopped) return;
    if (body.t === 'move-refused' || body.t === 'roll-refused') {
      this.ports.send(body, to, body.t === 'move-refused' && body.x !== null ? this.assetValidity(to ?? '*') : undefined);
      return;
    }
    if (this.recipients !== null) this.recipients.deliverShared(body, to, liveKey, validity);
    else if (liveKey !== undefined && this.ports.sendLive !== undefined) this.ports.sendLive(body, liveKey, to, validity);
    else this.ports.send(body, to, validity);
  }

  private assetValidity(from: string, authorized?: () => boolean): DeliveryValidity {
    const generation = this.delivery;
    const current = this.recipients?.validity(from);
    return { ...current, recipient: from, scene: current?.scene ?? this.scene?.id ?? '', generation,
      valid: () => !this.stopped && generation === this.delivery && current?.valid() !== false && authorized?.() !== false,
    };
  }

  private artPath(hash: string, from: string): string | undefined {
    return (this.personal ? this.recipients?.artPath(from, hash) : this.party.artPath(hash)) ?? this.ports.logArt?.(hash, from);
  }

  private schedulePoll(): void {
    if (this.stopped) return;
    this.poll = this.ports.setTimer(() => { this.poll = undefined; if (!this.stopped) { void this.update(this.store.getState()); this.schedulePoll(); } }, TOKEN_POLL_MS);
  }

  private async update(state: SceneState): Promise<void> {
    if (this.stopped) return;
    if (!state.mapLoaded || state.isMapLoading) {
      if (this.ports.held?.() === true) { this.agency?.sceneChanged(); return; }
      if (this.key !== null || this.scene !== null) this.withdraw();
      else this.agency?.sceneChanged();
      return;
    }
    const lit = isLit(state, this.ports.atlasSettings());
    const refusal = lit && this.ports.lightingSource() === null ? LIGHTING_REFUSAL : null;
    if (refusal !== null) {
      if (refusal !== this.refusal) this.ports.notice(refusal);
      this.refusal = refusal;
      if (this.key !== null || this.scene !== null) this.withdraw();
      return;
    }
    this.refusal = null;
    const key = `${state.mapPath ?? ''}\n${state.background ?? ''}\n${lit}`;
    if (key === this.key) { this.party.update(); this.recipients?.update(); this.agency?.ownersChanged(); return; }
    const generation = ++this.generation;
    this.key = key;
    if (this.personal && this.scene !== null) this.ports.send({ t: 'scene', scene: null });
    this.delivery += 1;
    this.party.setScene(null);
    this.recipients?.setScene(null, null);
    this.agency?.sceneChanged();
    const built = await this.build(state.background, generation);
    if (this.stopped || this.generation !== generation) return;
    if (built === null) { this.ports.notice('Atlas Online cannot send this scene\'s map image.'); this.publish(null, null); return; }
    this.publish({ id: this.ports.randomId(), map: built.map, lit }, built.bytes, built.size);
  }

  private async build(background: string | null, generation: number): Promise<BuiltScene | null> {
    if (background === null) return { map: null, bytes: null, size: null };
    const image = await this.ports.readImage(background);
    if (this.stopped || this.generation !== generation || image === null || image.bytes.length > MAX_ASSET_BYTES) return null;
    const size = headerOf(new DataView(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength));
    return { map: { hash: await sha256Hex(image.bytes), size: image.bytes.length, mime: image.mime }, bytes: image.bytes, size };
  }

  private publish(scene: SharedScene | null, bytes: Uint8Array<ArrayBuffer> | null, size: MapSize | null = null): void {
    if (this.stopped) return;
    this.delivery += 1;
    this.scene = scene;
    this.mapBytes = bytes;
    this.mapSize = size;
    this.agency?.sceneChanged();
    this.party.setScene(null);
    this.recipients?.setScene(scene, size);
    this.resend();
    this.party.setScene(scene);
    this.recipients?.update();
  }
}
