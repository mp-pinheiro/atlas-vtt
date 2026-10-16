import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { GmMessage, SharedScene } from '../../../src/app/online/protocol/game.ts';
import type { BookMessage, PlayerBook } from '../../../src/app/online/protocol/book.ts';
import type { LogEntry, LogMessage } from '../../../src/app/online/protocol/log.ts';
import type { ImageMessage } from '../../../src/app/online/protocol/image.ts';
import type { SharedFog } from '../../../src/app/online/protocol/fog.ts';
import type { SharedSight, SharedLightingScene } from '../../../src/app/online/protocol/lighting.ts';
import type { SharedGrid, SharedDoor, SharedPin, SharedAnnotations, SensedMark } from '../../../src/app/online/protocol/mapLayers.ts';
import type { RulesMessage } from '../../../src/app/online/protocol/rules.ts';
import type { LiveMessage } from '../../../src/app/online/protocol/live.ts';
import type { SharedInitiative } from '../../../src/app/online/protocol/initiative.ts';
import type { SharedWidgetBar } from '../../../src/app/online/protocol/widgets.ts';
import type { PictureChannel } from '../../../src/app/online/protocol/picture.ts';
import type { AgencyResponse } from '../../../src/app/online/protocol/agency.ts';
import type { MarksMessage } from '../../../src/app/online/protocol/marks.ts';

export type PlayerStatus = 'joining' | 'waiting' | 'connected' | 'disconnected' | 'blocked' | 'invalid-table';
export type PlayerTokens = Extract<GmMessage, { readonly t: 'tokens' }>;
export type PlayerMine = Extract<GmMessage, { readonly t: 'mine' }>;
export type PlayerAgency = Extract<GmMessage, { readonly t: 'agency' }>;
export type PlayerRules = RulesMessage;
export type PlayerExplored = { readonly t: 'explored'; readonly scene: string; readonly mask: AssetRef | null };

export interface PlayerSceneState {
  readonly scene: SharedScene;
  readonly tokens: PlayerTokens | null;
  readonly fog: SharedFog | null;
  readonly sight: SharedSight | null;
  readonly lighting: SharedLightingScene | null;
  readonly mine: PlayerMine | null;
  readonly grid: SharedGrid | null;
  readonly doors: readonly SharedDoor[] | null;
  readonly sensed: readonly SensedMark[] | null;
  readonly pins: readonly SharedPin[] | null;
  readonly annotations: SharedAnnotations | null;
  readonly rules: PlayerRules | null;
  readonly agency: PlayerAgency | null;
  readonly live: LiveMessage | null;
  readonly initiative: SharedInitiative | null;
  readonly widgets: SharedWidgetBar | null;
  readonly explored: PlayerExplored | null;
  readonly marks: MarksMessage | null;
  readonly covered: boolean;
  readonly pictureRevision: number;
}
export interface PlayerIdentity { readonly playerId?: string; readonly key?: string; readonly wait?: string }

export interface PlayerPoint { readonly x: number; readonly y: number }
export interface PlayerActionFeedback { readonly scene: string; readonly request: string; readonly status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'refused'; readonly cancelInFlight?: boolean; readonly reason?: string }
export interface PlayerState {
  readonly status: PlayerStatus;
  readonly notice: string | null;
  readonly gmOnline: boolean;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly people: LogMessage | null;
  readonly log: readonly LogEntry[];
  readonly book: PlayerBook | null;
  readonly shownImage: ImageMessage | null;
  readonly scene: PlayerSceneState | null;
  readonly generation: number;
  readonly busy: boolean;
  readonly transportGeneration: number;
  readonly predictions: Readonly<Record<string, PlayerPoint>>;
  readonly proposals: Readonly<Record<string, readonly PlayerPoint[]>>;
  readonly feedback: readonly PlayerActionFeedback[];
  readonly setStatus: (status: PlayerStatus, notice?: string | null) => void;
  readonly setConnection: (playerId: string | null, playerName: string | null, gmOnline: boolean) => void;
  readonly setPeople: (message: LogMessage) => void;
  readonly setLog: (message: LogMessage) => void;
  readonly setBook: (message: BookMessage) => void;
  readonly setShownImage: (message: ImageMessage) => void;
  readonly beginScene: (scene: SharedScene) => void;
  readonly clearScene: () => void;
  readonly applySceneMessage: (message: GmMessage) => void;
  readonly commitPicture: (scene: string, revision: number, whole: boolean, channels: Readonly<Partial<Record<PictureChannel, GmMessage>>>) => void;
  readonly setBusy: (busy: boolean) => void;
  readonly forgetTable: () => void;
  readonly beginTransportGeneration: () => void;
  readonly setPrediction: (token: string, point: PlayerPoint | null) => void;
  readonly setProposal: (token: string, points: readonly PlayerPoint[] | null) => void;
  readonly recordAgencyResponse: (response: AgencyResponse) => void;
  readonly appendFeedback: (feedback: PlayerActionFeedback) => void;
}

const emptyScene = (scene: SharedScene): PlayerSceneState => ({
  scene, tokens: null, fog: null, sight: null, lighting: null, mine: null, grid: null, doors: null,
  sensed: null, pins: null, annotations: null, rules: null, agency: null, live: null,
  initiative: null, widgets: null, explored: null, marks: null, covered: true, pictureRevision: 0,
});

function changedScene(current: PlayerSceneState, message: GmMessage): PlayerSceneState {
  switch (message.t) {
    case 'tokens': return { ...current, tokens: message, live: null };
    case 'fog': return { ...current, fog: message.fog };
    case 'sight': return { ...current, sight: message };
    case 'lighting': return { ...current, lighting: message };
    case 'mine': return { ...current, mine: message };
    case 'grid': return { ...current, grid: message.grid };
    case 'doors': return { ...current, doors: message.doors };
    case 'sensed': return { ...current, sensed: message.tokens };
    case 'pins': return { ...current, pins: message.pins };
    case 'annotations': return { ...current, annotations: message };
    case 'rules': return { ...current, rules: message };
    case 'agency': return { ...current, agency: message };
    case 'live': return { ...current, live: message };
    case 'initiative': return { ...current, initiative: message.list };
    case 'widgets': return { ...current, widgets: message.bar };
    case 'explored': return { ...current, explored: message };
    case 'marks': return { ...current, marks: message };
    default: return current;
  }
}

export function createPlayerStore(): StoreApi<PlayerState> {
  return createStore<PlayerState>((set) => ({
    status: 'joining', notice: null, gmOnline: false, playerId: null, playerName: null, people: null,
    log: [], book: null, shownImage: null, scene: null, generation: 0, transportGeneration: 0,
    predictions: {}, proposals: {}, feedback: [], busy: false,
    setStatus: (status, notice = null) => set({ status, notice }),
    setConnection: (playerId, playerName, gmOnline) => set({ playerId, playerName, gmOnline }),
    setPeople: (message) => set({ people: message }),
    setLog: (message) => set((state) => {
      if (message.t === 'log') return { log: [...message.entries] };
      if (message.t === 'log-entry') {
        const index = state.log.findIndex((entry) => entry.id === message.entry.id);
        const log = [...state.log];
        if (index < 0) log.push(message.entry);
        else log[index] = message.entry;
        return { log };
      }
      if (message.t === 'log-remove') return { log: state.log.filter((entry) => entry.id !== message.id) };
      return {};
    }),
    setBook: (message) => set((state) => {
      if (message.t === 'book') return { book: message.book };
      if (message.t === 'book-sheet') return { book: state.book === null ? null : { ...state.book, character: message.character } };
      if (message.t === 'book-map') return { book: state.book === null ? null : { ...state.book, worldMap: message.worldMap } };
      if (message.t === 'book-quests') return { book: state.book === null ? null : { ...state.book, quests: message.quests } };
      if (message.t === 'book-item') return { book: state.book === null ? null : { ...state.book, items: [...state.book.items.filter((item) => item.id !== message.item.id), message.item] } };
      return {};
    }),
    setShownImage: (shownImage) => set({ shownImage }),
    beginScene: (scene) => set((state) => ({
      scene: emptyScene(scene), generation: state.generation + 1, predictions: {}, proposals: {}, feedback: [],
    })),
    clearScene: () => set((state) => ({
      scene: null, generation: state.generation + 1, predictions: {}, proposals: {}, feedback: [],
    })),
    applySceneMessage: (message) => set((state) => {
      if (message.t === 'scene') {
        if (message.scene === null) return state.scene === null ? {} : {
          scene: null, generation: state.generation + 1, predictions: {}, proposals: {}, feedback: [],
        };
        if (state.scene?.scene.id === message.scene.id) return {};
        return {
          scene: emptyScene(message.scene), generation: state.generation + 1, predictions: {}, proposals: {}, feedback: [],
        };
      }
      if (state.scene === null || !('scene' in message) || message.scene !== state.scene.scene.id) return {};
      const scene = changedScene(state.scene, message);
      const ready = scene.tokens !== null && scene.fog !== null && (!scene.scene.lit || (scene.sight !== null && scene.lighting !== null));
      const changedOwnerSet = message.t === 'mine' && JSON.stringify(state.scene.mine?.tokens) !== JSON.stringify(message.tokens);
      return {
        scene: { ...scene, covered: !scene.scene.personal && ready ? false : scene.covered },
        ...(changedOwnerSet ? { predictions: {}, proposals: {}, feedback: [] } : {}),
      };
    }),
    commitPicture: (scene, revision, whole, channels) => set((state) => {
      const current = state.scene;
      if (current === null || current.scene.id !== scene) return {};
      if (!whole && revision <= current.pictureRevision) return {};
      if (!whole && revision !== current.pictureRevision + 1) return { scene: { ...current, covered: true } };
      let next = whole ? { ...emptyScene(current.scene), initiative: current.initiative, widgets: current.widgets, explored: current.explored, marks: current.marks } : current;
      for (const message of Object.values(channels)) {
        if (message !== undefined && message.t !== 'live') next = changedScene(next, message);
      }
      if (channels.live !== undefined) next = changedScene(next, channels.live);
      const changedOwnerSet = current.mine !== null && next.mine !== null && JSON.stringify(current.mine.tokens) !== JSON.stringify(next.mine.tokens);
      return {
        scene: { ...next, covered: whole ? false : next.covered, pictureRevision: revision },
        ...(changedOwnerSet ? { predictions: {}, proposals: {}, feedback: [] } : {}),
      };
    }),
    setBusy: (busy) => set({ busy }),
    beginTransportGeneration: () => set((state) => ({
      transportGeneration: state.transportGeneration + 1,
      gmOnline: false, busy: false,
      predictions: {}, proposals: {}, feedback: [],
      ...(state.scene === null ? {} : { scene: emptyScene(state.scene.scene) }),
    })),
    setPrediction: (token, point) => set((state) => {
      const predictions = { ...state.predictions };
      if (point === null) delete predictions[token];
      else predictions[token] = point;
      return { predictions };
    }),
    setProposal: (token, points) => set((state) => {
      const proposals = { ...state.proposals };
      if (points === null) delete proposals[token];
      else proposals[token] = points;
      return { proposals };
    }),
    recordAgencyResponse: (response) => set((state) => {
      if (state.scene === null || response.scene !== state.scene.scene.id) return {};
      if (response.t === 'agency') return { scene: changedScene(state.scene, response) };
      let feedback: PlayerActionFeedback | null = null;
      if (response.t === 'claim-result') feedback = {
        scene: response.scene, request: response.request, status: response.status,
      };
      else if (response.t === 'path-result') feedback = {
        scene: response.scene, request: response.request,
        status: response.result === 'approved' ? 'accepted' : response.reason === 'refused' ? 'refused' : 'cancelled',
        ...(response.reason === undefined ? {} : { reason: response.reason }),
      };
      else if (response.t === 'door-result') feedback = {
        scene: response.scene, request: response.request, status: response.result === 'refused' ? 'refused' : 'accepted',
      };
      else if (response.t === 'initiative-refused') feedback = {
        scene: response.scene, request: response.combatant, status: 'refused', reason: response.action,
      };
      if (feedback === null) return {};
      return { feedback: [...state.feedback.filter((item) => item.request !== feedback?.request), feedback].slice(-64) };
    }),
    appendFeedback: (feedback) => set((state) => {
      if (state.scene?.scene.id !== feedback.scene) return {};
      return { feedback: [...state.feedback.filter((item) => item.request !== feedback.request), feedback].slice(-64) };
    }),
    forgetTable: () => set((state) => ({
      playerId: null, playerName: null, gmOnline: false, people: null, log: [], book: null,
      shownImage: null, scene: null, generation: state.generation + 1, transportGeneration: state.transportGeneration + 1,
      predictions: {}, proposals: {}, feedback: [], busy: false,
    })),
  }));
}
