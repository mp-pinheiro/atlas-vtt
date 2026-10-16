import { Application, Container, Graphics, Matrix, Texture } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { RenderScheduler, requestRender } from '../../../src/app/pixi/RenderScheduler.ts';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree.ts';
import { SensedOutlines } from '../../../src/app/pixi/token-renderer/SensedOutlines.ts';
import { webglAvailable } from '../../../src/app/pixi/utils/webglAvailable.ts';
import { playerText } from '../i18n.ts';
import type { MeasureRules } from '../../../src/app/online/marks/RemoteMeasures.ts';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { PlayerState } from '../state/playerStore.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { PlayerMap } from './PlayerMap.ts';
import { PlayerFog } from './PlayerFog.ts';
import { PlayerLighting } from './PlayerLighting.ts';
import { PlayerGrid } from './PlayerGrid.ts';
import { PlayerLayers } from './PlayerLayers.ts';
import { PlayerTokens } from './PlayerTokens.ts';
import { PlayerDoorBadges } from './PlayerDoorBadges.ts';
import { PlayerInput, type PlayerTool, type ProposalPort } from './PlayerInput.ts';

export interface PlayerCanvasOptions {
  readonly host: HTMLElement;
  readonly assets: AssetDownloads;
  readonly send: (message: PlayerMessage) => boolean;
  readonly table: string;
  readonly onNotice?: (message: string) => void;
  readonly openFound?: (id: string) => void;
  readonly proposal?: ProposalPort;
}
interface Art { readonly promise: Promise<Texture>; users: number; texture: Texture | null; bitmap: ImageBitmap | null }
export class PlayerCanvas {
  readonly app: Application;
  readonly viewport: Viewport;
  private readonly scheduler: RenderScheduler;
  private readonly fog = new PlayerFog();
  private readonly grid: PlayerGrid;
  private readonly lighting: PlayerLighting;
  private readonly tokens: PlayerTokens;
  private readonly doors: PlayerDoorBadges;
  private readonly layers: PlayerLayers;
  private readonly sensed = new SensedOutlines();
  private readonly privacy = new Graphics({ label: 'player-privacy-cover' });
  private readonly world = new Container({ sortableChildren: true });
  private readonly cursors: HTMLDivElement;
  private readonly input: PlayerInput;
  private readonly resizeObserver: ResizeObserver;
  private readonly art = new Map<string, Art>();
  private state: PlayerState | null = null;
  private map: PlayerMap | null = null;
  private albedo: Texture | null = null;
  private albedoBitmap: ImageBitmap | null = null;
  private mapHash: string | null = null;
  private sceneId: string | null = null;
  private pendingMap: PlayerMap | null = null;
  private mapAttempt = 0;
  private transportGeneration: number | null = null;
  private exploredHash: string | null = null;
  private width = 1;
  private height = 1;
  private generation = 0;
  private destroyed = false;
  private contextLost = false;
  private lastMarks: unknown = null;
  private lastView = '';
  private mapHold: { hash: string; maxSide: number } | null = null;
  private maskHold: string | null = null;
  private readonly doorRequests = new Map<string, string>();
  private dirty = true;
  private loadingMap = false;
  static async create(options: PlayerCanvasOptions): Promise<PlayerCanvas> {
    const app = new Application();
    try {
      const gpu = webglAvailable();
      const settings = { width: Math.max(1, options.host.clientWidth), height: Math.max(1, options.host.clientHeight), resolution: window.devicePixelRatio || 1, autoDensity: true, background: '#171717', antialias: true };
      try { await app.init({ ...settings, preference: gpu ? ['webgl', 'canvas'] : ['canvas'] }); }
      catch (error) {
        if (!gpu) throw error;
        await app.init({ ...settings, preference: ['canvas'], canvas: options.host.ownerDocument.createElement('canvas') });
      }
      return new PlayerCanvas(options, app);
    } catch (error) { if (app.renderer) app.destroy(true); throw error; }
  }
  private constructor(private readonly options: PlayerCanvasOptions, app: Application) {
    this.app = app;
    options.host.appendChild(app.canvas);
    this.scheduler = new RenderScheduler(app);
    this.viewport = new Viewport({ screenWidth: app.screen.width, screenHeight: app.screen.height, worldWidth: 1, worldHeight: 1, events: app.renderer.events });
    this.viewport.wheel().pinch().clampZoom({ minScale: 0.01, maxScale: 5 });
    app.stage.addChild(this.viewport); this.viewport.addChild(this.world);
    this.cursors = options.host.ownerDocument.createElement('div');
    this.cursors.className = 'atlas-online-cursors'; this.cursors.style.pointerEvents = 'none'; this.cursors.style.position = 'absolute'; this.cursors.style.inset = '0'; options.host.appendChild(this.cursors);
    this.grid = new PlayerGrid(this.changed);
    this.lighting = new PlayerLighting(app.renderer, options.assets.exploredStore, this.invalidate, this.notice);
    this.tokens = new PlayerTokens({ acquire: (ref) => this.acquire(ref), release: (ref) => this.release(ref), changed: this.changed, ticker: app.ticker });
    this.doors = new PlayerDoorBadges(app.canvas, (id) => {
      const scene = this.state?.scene;
      if (!scene || !this.state?.gmOnline || !scene.agency?.permissions.playerDoors) return;
      const request = nonce();
      if (options.send({ t: 'door', scene: scene.scene.id, id, request })) this.doorRequests.set(request, id);
    }, this.changed);
    this.layers = new PlayerLayers(app.renderer, this.cursors, () => this.viewport.scale.x, () => this.measureRules());
    const ordered = [this.grid.container, this.tokens.view, this.lighting.container, this.layers.annotations, this.tokens.ui, this.sensed.view, this.doors.view, this.layers.pins, this.fog.container, this.layers.marks, this.layers.proposals, this.privacy];
    ordered.forEach((layer, index) => { layer.zIndex = index; this.world.addChild(layer); });
    this.input = new PlayerInput(app.canvas, this.viewport, { state: () => this.state, pick: (x, y) => this.tokens.hitTest(x, y), activate: (x, y) => {
      if (this.doors.hitTest(x, y)) { this.doors.activate(x, y); return true; }
      const pin = this.layers.hitPin(x, y); if (!pin || !this.state?.scene) return false;
      if (pin.found) options.openFound?.(pin.found); else options.send({ t: 'pin-found', scene: this.state.scene.scene.id, pin: pin.id }); return true;
    }, send: options.send, dimensions: () => ({ width: this.width, height: this.height }), changed: this.invalidate, ...(options.proposal ? { proposal: options.proposal } : {}) });
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(options.host);
    app.canvas.addEventListener('webglcontextlost', this.lost);
    app.canvas.addEventListener('webglcontextrestored', this.restored);
    app.ticker.add(this.tick);
    this.resize();
  }
  update(state: PlayerState): void {
    if (this.destroyed) return;
    this.state = state;
    if (state.transportGeneration !== this.transportGeneration) {
      this.transportGeneration = state.transportGeneration;
      const currentMap = state.scene?.scene.map;
      if (currentMap && this.map?.key !== currentMap.hash && this.mapHash !== null) {
        this.mapHash = null;
        ++this.mapAttempt;
        this.pendingMap?.destroy();
        this.pendingMap = null;
        this.loadingMap = false;
      }
    }
    this.layers.setPeople(state.people?.t === 'people' ? state.people.people : []);
    this.input.update(state);
    for (const feedback of state.feedback) {
      const door = this.doorRequests.get(feedback.request);
      if (!door) continue;
      this.doorRequests.delete(feedback.request);
      if (feedback.status === 'refused') this.doors.refuse(door);
    }
    const scene = state.scene;
    if (scene?.scene.id !== this.sceneId) {
      this.sceneId = scene?.scene.id ?? null;
      this.doorRequests.clear();
      if (this.mapHold) this.options.assets.release(this.mapHold.hash, this.mapHold.maxSide);
      this.mapHold = null;
      if (this.maskHold) this.options.assets.release(this.maskHold);
      this.maskHold = null;
      ++this.generation;
      ++this.mapAttempt;
      this.pendingMap?.destroy();
      this.pendingMap = null;
      this.loadingMap = false;
      this.map?.destroy(); this.map = null; this.mapHash = null; this.albedo?.destroy(true); this.albedo = null; this.albedoBitmap?.close(); this.albedoBitmap = null;
      this.lighting.reset(); this.layers.reset(); this.exploredHash = null; this.lastMarks = null;
    }
    if (!scene) { this.world.visible = false; return; }
    this.world.visible = true;
    const map = scene.scene.map;
    if (map && map.hash !== this.mapHash) { this.mapHash = map.hash; void this.openMap(map, this.generation, state.transportGeneration); }
    const mask = scene.scene.personal ? null : scene.explored?.mask;
    if ((mask?.hash ?? null) !== this.exploredHash) {
      if (this.maskHold) this.options.assets.release(this.maskHold);
      this.maskHold = null;
      this.exploredHash = mask?.hash ?? null;
      const generation = this.generation;
      if (!mask) void this.lighting.setSharedMask(null);
      else void this.options.assets.request(mask).then(async (blob) => {
        if (generation !== this.generation || this.destroyed || this.exploredHash !== mask.hash) { this.options.assets.release(mask.hash); return; }
        this.maskHold = mask.hash;
        await this.lighting.setSharedMask(blob);
        this.invalidate();
      }).catch(this.noticeError);
    }
    this.draw();
  }
  setTool(tool: PlayerTool): void { this.input.cancel(); this.input.tool = tool; }
  proposalAction(action: 'submit' | 'remove-last' | 'cancel'): void { this.input.proposalAction(action); }
  get proposalRequest(): string | null { return this.input.proposalRequest; }
  private async openMap(ref: AssetRef, sceneGeneration: number, transportGeneration: number, requestedSide?: number): Promise<void> {
    const attempt = ++this.mapAttempt;
    this.pendingMap?.destroy();
    this.pendingMap = null;
    const isCurrent = (): boolean => attempt === this.mapAttempt && sceneGeneration === this.generation && transportGeneration === this.transportGeneration && !this.destroyed;
    const maxSide = requestedSide ?? Math.max(256, Math.min(16384, Math.ceil(Math.max(this.app.screen.width, this.app.screen.height) * devicePixelRatio * 2)));
    this.loadingMap = true;
    let acquired = false;
    let nextMap: PlayerMap | null = null;
    let bitmap: ImageBitmap | null = null;
    try {
      const blob = await this.options.assets.request(ref, maxSide);
      acquired = true;
      if (!isCurrent()) return;
      let metadata = this.options.assets.metadataFor(ref, maxSide);
      if (!metadata) {
        const dimensions = await createImageBitmap(blob);
        metadata = { width: dimensions.width, height: dimensions.height };
        dimensions.close();
      }
      if (!isCurrent()) return;
      nextMap = new PlayerMap({ blob, byteHash: ref.hash, originalWidth: metadata.width, originalHeight: metadata.height, ticker: this.app.ticker, renderer: this.app.renderer, requestRender: this.changed, onUnavailable: this.noticeError });
      this.pendingMap = nextMap;
      bitmap = await nextMap.overview(2048);
      if (!isCurrent()) return;
      if (this.mapHold) this.options.assets.release(this.mapHold.hash, this.mapHold.maxSide);
      this.map?.destroy();
      this.mapHold = { hash: ref.hash, maxSide };
      acquired = false;
      this.width = metadata.width; this.height = metadata.height;
      this.map = nextMap; this.pendingMap = null;
      this.world.addChildAt(nextMap.container, 0); nextMap.container.zIndex = -1;
      nextMap = null;
      this.lastView = '';
      this.viewport.resize(this.app.screen.width, this.app.screen.height, this.width, this.height);
      if (requestedSide === undefined) { this.viewport.fitWorld(); this.viewport.moveCenter(this.width / 2, this.height / 2); }
      this.albedo?.destroy(true); this.albedoBitmap?.close();
      this.albedoBitmap = bitmap; this.albedo = Texture.from(bitmap); this.albedo.source.autoGenerateMipmaps = true;
      bitmap = null;
      this.draw();
    } catch (error) {
      if (isCurrent()) this.noticeError(error);
    } finally {
      if (nextMap) {
        if (this.pendingMap === nextMap) this.pendingMap = null;
        nextMap.destroy();
      }
      bitmap?.close();
      if (acquired) this.options.assets.release(ref.hash, maxSide);
      if (attempt === this.mapAttempt) this.loadingMap = false;
    }
  }
  private draw(): void {
    const state = this.state; const scene = state?.scene;
    if (!state || !scene || this.destroyed) return;
    const { width, height } = this;
    this.privacy.clear().rect(0, 0, width, height).fill(0x000000);
    this.privacy.visible = true;
    this.fog.update(scene.fog, width, height, scene.scene.id);
    const visible = (point: { x: number; y: number }): boolean => !scene.covered && !this.contextLost && this.fog.visible(point);
    const live = new Map(scene.live?.tokens.map((token) => [token.id, token]) ?? []);
    const tokens = (scene.tokens?.tokens ?? []).map((token) => ({ ...token, ...(live.get(token.id) ?? {}), ...(this.input.predictions[token.id] ?? {}) }));
    this.grid.update(scene.grid, width, height, this.map, this.viewport.scale.x);
    const mapRef = scene.scene.map;
    const mapReady = mapRef !== null && this.map?.key === mapRef.hash && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
    let lit = false;
    try { lit = !scene.covered && !this.contextLost && mapReady && this.lighting.update(scene, width, height, this.albedo, this.options.table, state.playerId ?? ''); }
    catch (error) { this.noticeError(error); }
    const seen = this.lighting.visibility(tokens);
    this.tokens.update(tokens, { cellSize: scene.tokens?.cell ?? 70, zoom: this.viewport.scale.x, selected: this.input.selected ? new Set([this.input.selected]) : new Set(), held: new Set(Object.keys(this.input.predictions)), visible: (token) => visible(token) && (!scene.scene.lit || seen(token)) });
    this.lighting.setGrid(scene.scene.lit && lit ? this.grid : null);
    this.layers.update(scene.annotations, scene.pins, this.viewport.scale.x, visible);
    this.doors.update(scene.doors ?? [], scene.tokens?.cell ?? 70, (door) => visible({ x: (door.p[0] + door.p[2]) / 2, y: (door.p[1] + door.p[3]) / 2 }));
    this.sensed.sync((scene.sensed ?? []).filter(visible).map((mark, index) => ({ ...mark, id: String(index) }))); this.sensed.view.visible = true;
    if (scene.marks !== this.lastMarks) { this.lastMarks = scene.marks; this.layers.receiveMarks(scene.marks ?? { t: 'marks', scene: scene.scene.id, lasers: [], measures: [] }, performance.now()); }
    this.layers.proposals.clear();
    const origin = scene.tokens?.tokens.find((token) => state.proposals[token.id] !== undefined);
    const destinations = this.input.proposalPoints;
    const points = origin && destinations.length > 0 ? [{ x: origin.x, y: origin.y }, ...destinations] : destinations;
    if (points.length > 0) { this.layers.proposals.moveTo(points[0]!.x, points[0]!.y); for (const point of points.slice(1)) this.layers.proposals.lineTo(point.x, point.y); this.layers.proposals.stroke({ color: 0xaaaaff, width: 3 / this.viewport.scale.x }); for (const point of points) this.layers.proposals.circle(point.x, point.y, 5 / this.viewport.scale.x).fill(0xaaaaff); }
    this.privacy.visible = scene.covered || this.contextLost || !lit || (scene.scene.map !== null && this.map === null);
    requestRender(this.app);
  }
  private measureRules(): MeasureRules | null {
    const rules = this.state?.scene?.rules;
    if (!rules) return null;
    return { grid: rules.grid, measurement: { ...rules.measurement, rangeBands: [...rules.measurement.rangeBands] } };
  }
  private readonly tick = (): void => {
    if (this.destroyed) return;
    if (this.dirty) { this.dirty = false; this.draw(); }
    const view = { x: -this.viewport.x / this.viewport.scale.x, y: -this.viewport.y / this.viewport.scale.y, width: this.app.screen.width / this.viewport.scale.x, height: this.app.screen.height / this.viewport.scale.y, worldPerScreenPixel: 1 / this.viewport.scale.x };
    const key = JSON.stringify(view);
    this.lighting.setGrid(this.state?.scene?.scene.lit && !this.contextLost ? this.grid : null);
    if (key !== this.lastView) {
      this.lastView = key;
      void this.map?.update(view).catch(this.noticeError);
      this.lighting.setView(new Matrix(view.worldPerScreenPixel, 0, 0, view.worldPerScreenPixel, view.x, view.y), this.viewport.scale.x);
      this.draw();
    }
    const ref = this.state?.scene?.scene.map;
    const desired = Math.min(16384, Math.max(256, Math.ceil(Math.max(this.width, this.height) * this.viewport.scale.x * devicePixelRatio * 2)));
    if (ref && this.mapHold && !this.loadingMap && desired > this.mapHold.maxSide * 1.5) void this.openMap(ref, this.generation, this.transportGeneration ?? 0, desired);
    const now = performance.now(); this.layers.tick(now, { x: this.viewport.x, y: this.viewport.y, scale: this.viewport.scale.x });
    if (this.lighting.tick(now)) requestRender(this.app);
  };
  private readonly changed = (): void => { if (!this.destroyed) requestRender(this.app); };
  private readonly invalidate = (): void => { if (!this.destroyed) { this.dirty = true; requestRender(this.app); } };
  private readonly notice = (message: string): void => { this.options.onNotice?.(message); };
  private readonly noticeError = (error: unknown): void => { console.error('Atlas player canvas could not draw an image or lighting input', error); this.notice(playerText('imageUnavailable')); };
  private readonly resize = (): void => {
    const { clientWidth: width, clientHeight: height } = this.options.host;
    if (this.destroyed || width <= 0 || height <= 0) return;
    const center = this.viewport.center;
    this.app.renderer.resize(width, height); this.viewport.resize(width, height, this.width, this.height); this.viewport.moveCenter(center.x, center.y); this.changed();
  };
  private readonly lost = (event: Event): void => { event.preventDefault(); this.contextLost = true; this.lighting.contextLost(); this.input.cancel(); this.draw(); };
  private readonly restored = (): void => { this.contextLost = false; this.lighting.reset(); this.draw(); };
  private acquire(ref: AssetRef): Promise<Texture> {
    const existing = this.art.get(ref.hash);
    if (existing) { ++existing.users; return existing.promise; }
    let row: Art;
    const promise = this.options.assets.request(ref).then(async (blob) => {
      let bitmap: ImageBitmap | null = null;
      let texture: Texture | null = null;
      try {
        bitmap = await createImageBitmap(blob);
        if (this.destroyed || row.users === 0) throw new Error('Token artwork was released.');
        texture = Texture.from(bitmap);
        row.bitmap = bitmap; row.texture = texture;
        return texture;
      } catch (error) {
        texture?.destroy(true);
        bitmap?.close();
        this.options.assets.release(ref.hash);
        throw error;
      }
    }).catch((error: unknown) => {
      if (this.art.get(ref.hash) === row) this.art.delete(ref.hash);
      throw error;
    });
    row = { users: 1, texture: null, bitmap: null, promise };
    this.art.set(ref.hash, row);
    return promise;
  }
  private release(ref: AssetRef): void { const art = this.art.get(ref.hash); if (!art || --art.users > 0) return; this.art.delete(ref.hash); art.texture?.destroy(true); art.bitmap?.close(); this.options.assets.release(ref.hash); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; ++this.generation; ++this.mapAttempt; this.pendingMap?.destroy(); this.pendingMap = null; this.resizeObserver.disconnect(); this.app.ticker.remove(this.tick); this.input.destroy();
    this.app.canvas.removeEventListener('webglcontextlost', this.lost); this.app.canvas.removeEventListener('webglcontextrestored', this.restored);
    if (this.mapHold) this.options.assets.release(this.mapHold.hash, this.mapHold.maxSide);
    if (this.maskHold) this.options.assets.release(this.maskHold);
    this.map?.destroy(); this.tokens.destroy(); this.doors.destroy(); this.lighting.destroy(); this.grid.destroy(); this.fog.destroy(); this.layers.destroy(); this.sensed.destroy(); this.scheduler.destroy();
    for (const art of this.art.values()) { art.users = 0; art.texture?.destroy(true); art.bitmap?.close(); } this.art.clear(); this.albedo?.destroy(true); this.albedoBitmap?.close(); this.cursors.remove(); destroyTree(this.world); this.viewport.destroy(); this.app.destroy(true);
  }
}
function nonce(): string { return Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => value.toString(16).padStart(2, '0')).join(''); }
