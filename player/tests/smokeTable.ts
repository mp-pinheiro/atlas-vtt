import { EventEmitter } from 'node:events';
import { crc32, deflateSync } from 'node:zlib';
import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile, stringifyYaml } from 'obsidian';
import { createViewAtlasStore, type ViewAtlasState } from '../../src/app/storeFactory.ts';
import { OnlineTable } from '../../src/app/online/gm/OnlineTable.ts';
import { Ownership, readOwnership, type OwnershipData } from '../../src/app/online/gm/ownership.ts';
import { BookShelf } from '../../src/app/online/gm/book/BookShelf.ts';
import { setWorldMapGate } from '../../src/app/online/gm/book/worldMapGate.ts';
import { DiceTool } from '../../src/app/tools/DiceTool.ts';
import { runUntracked, getHistoryStore } from '../../src/app/stores/history.ts';
import { SceneModelBuilder, type SceneModel } from '../../src/app/vision/sceneModel.ts';
import { tokenPerception, type TokenPerception } from '../../src/app/vision/tokenPerception.ts';
import { FogCoverageCache } from '../../src/app/fog/FogCoverageCache.ts';
import { resolveMeasurementSettings } from '../../src/app/grid/measurementFormat.ts';
import { randomHex } from '../../src/app/utils/randomHex.ts';
import type { CreatedTable } from '../../src/app/online/gm/createdTable.ts';
import type { Character, TokenEntity } from '../../src/app/types.ts';
import { setQuestGate } from '../../src/app/online/gm/book/questGate.ts';
import { sha256 } from '../../src/app/utils/hashing.ts';
import type { GateSettings, GateView } from '../../src/app/online/gm/joinGate.ts';
import type { GmLogEntry } from '../../src/app/online/gm/log/logEntries.ts';
import type { PendingPath, PendingPaths } from '../../src/app/online/gm/PendingPaths.ts';
import type { ClaimRequests, PendingClaim } from '../../src/app/online/gm/claims.ts';
import { TemplateLibrary } from '../../src/app/statblocks/library/TemplateLibrary.ts';

export type SmokeSceneState = ViewAtlasState;
export interface SmokeSceneStore {
  getState(): SmokeSceneState;
  setState(recipe: (state: SmokeSceneState) => void): void;
  subscribe(listener: () => void): () => void;
}

export interface SmokeSnapshot {
  readonly status: string;
  readonly gate: GateView;
  readonly ownership: OwnershipData;
  readonly state: SmokeSceneState;
  readonly log: readonly GmLogEntry[];
  readonly paths: readonly PendingPath[];
  readonly claims: readonly PendingClaim[];
  readonly editingRequest: string | null;
}
export interface SmokeTable {
  readonly app: App;
  readonly store: SmokeSceneStore;
  readonly ownership: Ownership;
  readonly shelf: BookShelf;
  readonly online: OnlineTable;
  readonly connection: { readonly origin: string; readonly table: string; readonly code: string };
  snapshot(): SmokeSnapshot;
  subscribe(listener: () => void): () => void;
  command(command: Record<string, unknown>): Promise<unknown>;
  stop(): void;
}

export const SMOKE_MAP = 'atlas-vtt/collections/Smoke/scenes/Two rooms.atlasmap';
const IMAGE = 'atlas-vtt/collections/Smoke/maps/Two rooms.png';
const SIZE = 1400;

function png(width: number, height: number, tone = 0): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    rows.set(x % 70 < 2 || y % 70 < 2 ? [75, 80, 85] : x < width / 2 ? [190, 165 - tone, 130] : [130 + tone, 170, 190], offset);
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

export async function createSmokeTable(options: { origin: string; table: CreatedTable }): Promise<SmokeTable> {
  const changes = new Set<() => void>();
  let online: OnlineTable;
  let watchedPaths: PendingPaths | null = null;
  let stopPaths: (() => void) | undefined;
  let watchedClaims: ClaimRequests | null = null;
  let stopClaims: (() => void) | undefined;
  const notify = (): void => {
    const next = online?.pendingPaths ?? null;
    if (next !== watchedPaths) { stopPaths?.(); watchedPaths = next; stopPaths = next?.subscribe(notify); }
    const claims = online?.claimRequests ?? null;
    if (claims !== watchedClaims) { stopClaims?.(); watchedClaims = claims; stopClaims = claims?.onChange(notify); }
    for (const listener of changes) listener();
  };
  const workspaceBus = new EventEmitter();
  const bus = new EventEmitter();
  const files = new Map<string, Uint8Array<ArrayBuffer>>([[IMAGE, png(SIZE, SIZE)]]);
  for (const [index, id] of ['alice', 'bob', 'goblin-left', 'goblin-right', 'unclaimed'].entries()) files.set(`art/${id}.png`, png(64, 64, 10 * index));
  const nativeFields = { statblock: true, 'atlas-template': 'builtin:5e-2024-monster', name: 'Alice', hp: 12, ac: 14, stats: [16, 12, 12, 10, 10, 10], actions: [{ name: 'Lantern strike', desc: 'Melee attack: +3 to hit. Hit: 1d6 + 3 damage.' }] };
  files.set('notes/Alice.md', Uint8Array.from(new TextEncoder().encode(`---\n${stringifyYaml(nativeFields)}---\n`)));
  files.set('notes/Lantern.md', Uint8Array.from(new TextEncoder().encode('# Lantern clue\n\nThe brass lantern lies beyond the eastern door. **Do not open the sealed arch.**\n')));
  const fileOf = (path: string): TFile | null => {
    const bytes = files.get(path); if (!bytes) return null;
    const file = new TFile(); file.path = path; file.name = path.split('/').pop() ?? path; file.basename = file.name.replace(/\.[^.]+$/, ''); file.extension = file.name.split('.').pop() ?? ''; file.stat = { ctime: 1, mtime: 1, size: bytes.byteLength }; return file;
  };
  const local = new Map<string, unknown>();
  const resources = [{ key: 'hp', name: 'Hit points', field: 'hp', direction: 'drains' as const, color: '#33aa66', visibleToPlayers: true }];
  const conditions = [{ id: 'frightened', name: 'Frightened', valued: true, color: '#b68acc' }];
  const assets = { getCollectionForMap: () => 'Smoke', getCollectionSettings: () => ({ conditions, resources }), getCollections: () => [{ id: 'Smoke', name: 'Smoke' }], isLoaded: () => true };
  let leaf: WorkspaceLeaf;
  const presented = { tabId: 'smoke-tab', filePath: SMOKE_MAP };
  const app = {
    loadLocalStorage: (key: string): unknown => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown): void => { local.set(key, value); },
    workspace: { onLayoutReady: (callback: () => void): void => { queueMicrotask(callback); }, getLeavesOfType: (type: string) => type === 'atlas-vtt' ? [leaf] : [], getMostRecentLeaf: () => leaf, on: (name: string, listener: (...args: unknown[]) => void) => { workspaceBus.on(name, listener); return { name, listener }; }, offref: (ref: { name: string; listener: (...args: unknown[]) => void }) => workspaceBus.off(ref.name, ref.listener), trigger: (name: string, ...args: unknown[]) => workspaceBus.emit(name, ...args) },
    vault: { getFileByPath: fileOf, getAbstractFileByPath: fileOf, getFiles: () => [...files.keys()].map(fileOf), readBinary: async (file: TFile) => files.get(file.path)!.slice().buffer, read: async (file: TFile) => new TextDecoder().decode(files.get(file.path)), cachedRead: async (file: TFile) => new TextDecoder().decode(files.get(file.path)), on: (name: string, listener: (...args: unknown[]) => void) => { workspaceBus.on(name, listener); return { name, listener }; }, offref: (ref: { name: string; listener: (...args: unknown[]) => void }) => workspaceBus.off(ref.name, ref.listener), adapter: { exists: async (path: string) => files.has(path), read: async (path: string) => new TextDecoder().decode(files.get(path)), write: async (path: string, text: string) => { files.set(path, Uint8Array.from(new TextEncoder().encode(text))); } } },
    metadataCache: { getFileCache: (file: TFile) => file.path === 'notes/Alice.md' ? { frontmatter: nativeFields } : {}, getFirstLinkpathDest: (path: string) => fileOf(path), on: (name: string, listener: (...args: unknown[]) => void) => { workspaceBus.on(name, listener); return { name, listener }; }, offref: (ref: { name: string; listener: (...args: unknown[]) => void }) => workspaceBus.off(ref.name, ref.listener) },
    plugins: { plugins: { 'atlas-vtt': { presentedScene: { get: () => presented, onChange: (listener: () => void) => { changes.add(listener); return () => changes.delete(listener); } }, settingsService: { isExperimentalOn: () => true, getLocalPlayerViewSettings: () => ({ showTokenNameplates: true, showInitiative: true, showWidgets: true, showDiceRolls: true, showCursors: true }) } } } },
  } as unknown as App;
  const store = createViewAtlasStore(app, 'smoke-view') as unknown as SmokeSceneStore;
  store.getState().setPersistenceEnabled(false);
  const hero = (id: string, name: string, x: number, y: number): Character => ({ id, kind: 'character', name, imagePath: `art/${id}.png`, x, y, size: 1, side: 'players', vision: { enabled: true, range: 30 }, resources: { hp: { current: 10, max: 12 } } });
  runUntracked(store, () => store.setState((state) => {
    state.mapPath = SMOKE_MAP; state.background = IMAGE; state.mapLoaded = true; state.isMapLoading = false;
    state.grid = { ...state.grid!, type: 'square', size: 70, offsetX: 0, offsetY: 0 };
    state.lighting = { enabled: true, ambient: 1 };
    state.objects.tokens = { alice: { ...hero('alice', 'Alice', 315, 315), statblockPath: 'notes/Alice.md' }, bob: hero('bob', 'Bob', 1085, 315), unclaimed: hero('unclaimed', 'Unclaimed scout', 315, 525), 'goblin-left': { ...hero('goblin-left', 'Left-room goblin', 455, 315), side: 'opponents', vision: { enabled: false } }, 'goblin-right': { ...hero('goblin-right', 'Right-room goblin', 945, 315), side: 'opponents', vision: { enabled: false } } };
    state.objects.walls = Object.fromEntries([
      ['top', 0, 245, 'solid'], ['door', 245, 315, 'door'], ['middle', 315, 735, 'solid'], ['secret', 735, 805, 'secret-door'], ['bottom', 805, SIZE, 'solid'],
    ].map(([id, y1, y2, type]) => [id, { id, kind: 'wall', type, p1: { x: 700, y: y1 }, p2: { x: 700, y: y2 }, closed: true }])) as typeof state.objects.walls;
    state.objects.fog = { corner: { id: 'corner', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 1260, width: 1400, height: 140 } };
    state.objects.pins = { lantern: { id: 'lantern', kind: 'pin', x: 455, y: 525, notePath: 'notes/Lantern.md', readable: true } };
    state.widgetSettings = { globalVisible: true, position: 'top', scale: 1, widgets: { torch: { id: 'torch', type: 'timer', label: 'Torch', icon: 'flame', visible: true, visibleToPlayers: true, value: 3600, duration: 3600, direction: 'down', running: { since: Date.now(), remaining: 3600 }, order: 0 } } };
  }));
  store.getState().setInitiativeTrackerOpen(true);
  for (const id of ['alice', 'bob']) {
    const token = store.getState().objects.tokens[id]!;
    store.getState().addToInitiative({ tokenId: id, name: id === 'alice' ? 'Alice' : 'Bob', initiative: 0, hasInitiative: false, initiativeModifier: 0, imagePath: token.imagePath, isNPC: false });
  }
  store.getState().startCombat();
  getHistoryStore(store)?.getState().clear();
  const dice = new DiceTool(bus, () => ({ defaultRoll: '1d20', crit: 'natural' }), { random: Math.random, rollId: () => randomHex(12), roller: () => 'GM', onFormulaError: (error) => { throw new Error(String(error)); } });
  const builder = new SceneModelBuilder();
  const measurement = resolveMeasurementSettings(undefined, store.getState().grid);
  const rules = { conditions, definitions: [] };
  const coverage = new FogCoverageCache();
  const model = (): SceneModel => builder.update(store.getState(), { width: SIZE, height: SIZE }, () => measurement, () => rules).model;
  const perception = (): TokenPerception => { const current = model(); return tokenPerception(current.sight, current.ambient, current.reaches, store.getState().objects.tokens, { conditions, held: store.getState().heldTokens }); };
  const lightingView = { isEnabled: () => store.getState().lighting.enabled, sightIsCurrent: () => store.getState().mapLoaded && !store.getState().isMapLoading, currentSight: () => model().sight, ambientLight: () => model().ambient, lightReaches: () => model().reaches };
  const renderer = {
    getGridOptions: () => store.getState().grid,
    lightingFeature: { controller: { renderer: lightingView, playerSight: perception, sightAids: { deps: { rules: () => rules, measurement: () => measurement } } } },
    getTokenRenderer: () => ({ collectionSync: { resources: () => resources, conditions: () => conditions }, playerFramePerception: perception, getTokenSprites: () => Object.fromEntries(Object.values(store.getState().objects.tokens).map((token) => [token.id, { x: token.x, y: token.y, tokenSize: 70, position: { x: token.x, y: token.y } }])) }),
    playerRollTokens: (path: string, ids?: readonly string[]) => {
      const state = store.getState();
      if (path !== state.mapPath || !state.mapLoaded || state.isMapLoading) return new Map();
      const sees = perception();
      const fog = coverage.get(state.objects.fog, state.mapPath);
      return new Map((ids ?? Object.keys(state.objects.tokens)).flatMap((id) => { const token = state.objects.tokens[id]; return !token || sees(id) !== 'seen' || fog === null || fog.covers(token) ? [] : [[id, { name: token.kind === 'character' ? token.name : null, imagePath: token.imagePath, showRing: true, ringColor: token.ringColor }] as const]; }));
    },
    getMapRect: () => ({ x: 0, y: 0, width: SIZE, height: SIZE }),
  };
  const view = { viewId: 'smoke-view', atlasStore: store, containerEl: document.createElement('div'), getViewType: () => 'atlas-vtt', tabMetaStore: { getState: () => ({ tabs: [{ id: 'smoke-tab', filePath: SMOKE_MAP, displayName: 'Two rooms', isLoaded: true, isDirty: false }], activeTabId: 'smoke-tab' }), subscribe: (listener: () => void) => { changes.add(listener); return () => changes.delete(listener); } }, serviceManager: { getRendererService: () => ({ getRenderer: () => renderer }), getAssetService: () => assets, getToolController: () => ({ getDiceTool: () => dice }), getEventBus: () => bus } };
  leaf = { view } as unknown as WorkspaceLeaf;
  const ownership = new Ownership(readOwnership({}), notify);
  const shelf = new BookShelf({}, notify);
  let savedLog: unknown;
  let gateSettings: GateSettings = { code: '483912', requireCode: true, askToJoin: true };
  const makeOnline = (): OnlineTable => new OnlineTable(app, options.origin, options.table, SMOKE_MAP, ownership, gateSettings, { status: notify, mapPath: notify, ended: notify, changed: notify, gate: (next): void => { gateSettings = next; notify(); }, log: notify }, shelf, savedLog);
  const worldListeners = new Set<() => void>();
  setWorldMapGate({ worldMap: async () => ({ root: 'world', levels: [{ key: 'world', title: 'World', image: IMAGE, stretch: { x: 1, y: 1, rotation: 0 }, entrances: [{ x: 350, y: 350, to: 'region', label: 'Region' }] }, { key: 'region', title: 'Region', image: IMAGE, stretch: { x: 1, y: 1, rotation: 0 }, entrances: [{ x: 350, y: 350, to: 'town', label: 'Town' }] }, { key: 'town', title: 'Town', image: IMAGE, stretch: { x: 1, y: 1, rotation: 0 }, entrances: [] }] }), onChange: (listener) => { worldListeners.add(listener); return () => worldListeners.delete(listener); } });
  const questBytes = Uint8Array.from(new TextEncoder().encode('# The lost lantern\n\nFind the lantern behind the eastern door.\n\n' + 'The old road is safe only by daylight. '.repeat(100)));
  const questHash = await sha256(questBytes);
  setQuestGate({ quests: async () => [{ id: 'c'.repeat(24), kind: 'main', state: 'active', title: 'The lost lantern', body: 'Find the lantern behind the eastern door.', text: { hash: questHash, size: questBytes.byteLength, mime: 'text/markdown' }, place: null, xp: 100, rewards: ['A silver lantern'] }], asset: (hash) => hash === questHash ? { bytes: questBytes } : undefined, onChange: (listener) => { worldListeners.add(listener); return () => worldListeners.delete(listener); } });
  online = makeOnline();
  const unsubscribe = store.subscribe(notify);
  online.start();
  const snapshot = (): SmokeSnapshot => ({ status: online.status, gate: online.gate.view(), ownership: ownership.toData(), state: store.getState(), log: online.log.entries(), paths: online.pendingPaths?.getSnapshot() ?? [], claims: online.claimRequests?.entries() ?? [], editingRequest: online.pendingPaths?.editingRequest ?? null });
  return {
    app, store, ownership, shelf,
    get online(): OnlineTable { return online; },
    connection: { origin: options.origin, table: options.table.code, code: '483912' },
    snapshot,
    subscribe(listener: () => void): () => void { changes.add(listener); return () => changes.delete(listener); },
    async command(command: Record<string, unknown>): Promise<unknown> {
      if (typeof command.type !== 'string') throw new Error('A smoke command needs a type');
      if (command.type.startsWith('path-') && online.pendingPaths === null) throw new Error('No presented movement queue');
      if (command.type.startsWith('claim-') && online.claimRequests === null) throw new Error('No presented claim queue');
      switch (command.type) {
        case 'admit': online.gate.admit(String(command.id)); break;
        case 'decline': online.gate.decline(String(command.id)); break;
        case 'claim-accept': online.claimRequests?.accept(String(command.from), String(command.request)); break;
        case 'claim-decline': online.claimRequests?.decline(String(command.from), String(command.request)); break;
        case 'gate': online.gate.setAskToJoin(command.ask === true); break;
        case 'give': ownership.give([String(command.token)], store.getState().objects.tokens, command.player === null ? null : String(command.player)); break;
        case 'permission': ownership.setPermission(SMOKE_MAP, command.key as 'approval' | 'perPlayerVision' | 'playerConditions' | 'playerDoors', command.value === true); break;
        case 'move': store.getState().moveToken(String(command.id), Number(command.x), Number(command.y)); break;
        case 'hide': store.getState().updateToken(String(command.id), { isHidden: command.value === true }); break;
        case 'fog': store.setState((state) => { state.objects.fog = command.value === true ? { whole: { id: 'whole', kind: 'fog', type: 'rectangle', timestamp: Date.now(), isErasing: false, x: 0, y: 0, width: SIZE, height: SIZE } } : {}; }); break;
        case 'loading': store.setState((state) => { state.isMapLoading = command.value === true; }); break;
        case 'token-vision': {
          const id = String(command.id); const token = store.getState().objects.tokens[id];
          if (!token) throw new Error(`Unknown fixture token ${id}`);
          store.getState().updateToken(id, { vision: { ...token.vision, enabled: command.value === true } }); break;
        }
        case 'scene-token-vision': store.setState((state) => { state.lighting.tokenVision = command.value === true; }); break;
        case 'explored-memory': store.setState((state) => { state.lighting.exploredMemory = command.value === true; }); break;
        case 'widget-pause': store.setState((state) => { const torch = state.widgetSettings.widgets.torch; if (torch?.type === 'timer' && torch.running) { torch.value = Math.max(0, torch.value - Math.floor((Date.now() - torch.running.since) / 1000)); delete torch.running; } }); break;
        case 'widgets-clear': store.setState((state) => { state.widgetSettings.widgets = {}; }); break;
        case 'lock': store.getState().setDoorLocked(String(command.id), command.value === true); break;
        case 'show-image': return online.image.show(async () => ({ bytes: files.get(IMAGE)!, mime: 'image/png' }), IMAGE);
        case 'dismiss-image': return online.image.dismiss();
        case 'path-approve': online.pendingPaths?.approve(String(command.request)); break;
        case 'path-cancel': online.pendingPaths?.cancel(String(command.request)); break;
        case 'path-approve-all': online.pendingPaths?.approveAll(); break;
        case 'path-cancel-all': online.pendingPaths?.cancelAll(); break;
        case 'path-edit': online.pendingPaths?.beginEdit(String(command.request)); break;
        case 'path-done': online.pendingPaths?.endEdit(command.commit === true); break;
        case 'path-point': return online.pendingPaths?.editPoint(String(command.request), Number(command.index), { x: Number(command.x), y: Number(command.y) }) ?? false;
        case 'path-insert': return online.pendingPaths?.insertPoint(String(command.request), Number(command.index), { x: Number(command.x), y: Number(command.y) }) ?? false;
        case 'path-delete': return online.pendingPaths?.deletePoint(String(command.request), Number(command.index)) ?? false;
        case 'undo': getHistoryStore(store)?.getState().undo(); break;
        case 'redo': getHistoryStore(store)?.getState().redo(); break;
        case 'disconnect': savedLog = online.log.saved(); online.close(); break;
        case 'restart': savedLog = online.log.saved(); online.close(); online = makeOnline(); online.start(); break;
        case 'end': online.end(); break;
        case 'snapshot': return snapshot();
        default: throw new Error(`Unknown smoke command: ${String(command.type)}`);
      }
      notify(); return snapshot();
    },
    stop(): void { online.close(); stopPaths?.(); stopClaims?.(); unsubscribe(); changes.clear(); workspaceBus.removeAllListeners(); bus.removeAllListeners(); TemplateLibrary.release(app); setWorldMapGate(null); setQuestGate(null); },
  };
}
