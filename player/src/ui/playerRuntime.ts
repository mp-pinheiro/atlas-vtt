import type { StoreApi } from 'zustand/vanilla';
import type { PlayerState } from '../state/playerStore.ts';
import type { IdentityStorage } from '../storage/playerIdentity.ts';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import { parseAsset, parseTextAsset } from '../../../src/app/online/protocol/asset.ts';
import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { LogState } from '../../../src/app/online/tableLog/LogState.ts';
import { AssetDownloads } from '../assets/assetDownloads.ts';
import { PlayerConnection } from '../connection/playerConnection.ts';
import { PlayerOutbox } from '../connection/playerOutbox.ts';
import { PlayerRouter } from '../connection/playerRouter.ts';
import { createPlayerStore } from '../state/playerStore.ts';
import { playerIdentity } from '../storage/playerIdentity.ts';

export function referencedAssets(value: unknown): readonly AssetRef[] {
  const refs = new Map<string, AssetRef>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const ref = parseAsset(node) ?? parseTextAsset(node);
    if (ref !== null) { refs.set(ref.hash, ref); return; }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return [...refs.values()];
}

export interface PlayerRuntime {
  readonly table: string;
  readonly store: StoreApi<PlayerState>;
  readonly identity: IdentityStorage;
  readonly log: LogState;
  readonly assets: AssetDownloads;
  readonly send: (message: PlayerMessage) => boolean;
  join(input: { readonly name: string; readonly code?: string }): void;
  subscribe(listener: (message: GmMessage) => void): () => void;
  leave(): Promise<void>;
  stop(): void;
}

export function createPlayerRuntime(table: string, origin: string): PlayerRuntime {
  const store = createPlayerStore();
  const identity = playerIdentity(table);
  const log = new LogState(() => store.getState().playerId);
  const listeners = new Set<(message: GmMessage) => void>();
  let name = '';
  const connection = new PlayerConnection({
    table, origin, identity,
    onStatus: (status, notice) => {
      const state = store.getState();
      state.setStatus(status, notice);
      if (status === 'disconnected' || status === 'blocked') {
        state.setConnection(state.playerId, state.playerName, false);
        outbox.clear();
      }
    },
    onTransportGeneration: () => {
      outbox.clear();
      assets.resetTransport();
      store.getState().beginTransportGeneration();
    },
    onForget: async (forgotten) => {
      if (forgotten.playerId !== undefined) await assets.clearExplored(table, forgotten.playerId);
      store.getState().forgetTable();
      log.replace([]);
      log.keepDraft('');
    },
    onFrame: (frame) => {
      if (frame.t === 'welcome' && frame.role === 'player') store.getState().setConnection(frame.id, name, frame.gmOnline);
      else if (frame.t === 'gm') {
        const state = store.getState();
        state.setConnection(state.playerId, state.playerName, frame.online);
        if (!frame.online) outbox.clear();
      }
      router.receive(frame);
    },
  });
  const outbox = new PlayerOutbox({
    send: (message) => connection.send(message),
    online: () => store.getState().gmOnline,
    ready: () => connection.canSend(),
    onBusy: (busy) => store.getState().setBusy(busy),
  });
  const send = (message: PlayerMessage): boolean => {
    const accepted = outbox.send(message);
    if (accepted && (message.t === 'path' || message.t === 'claim-request')) store.getState().appendFeedback({ scene: message.scene, request: message.request, status: 'pending', reason: message.t });
    if (accepted && message.t === 'path-cancel') store.getState().appendFeedback({ scene: message.scene, request: message.request, status: 'pending', cancelInFlight: true, reason: 'path' });
    return accepted;
  };
  const assets = new AssetDownloads({
    send,
    onFinished: (hash, maxSide) => outbox.assetFinished(hash, maxSide),
    onNotice: (notice) => store.getState().setStatus(store.getState().status, notice),
  });
  const router = new PlayerRouter({
    store, send,
    onResyncComplete: (scene, channel) => outbox.resyncFinished(scene, channel),
    onMessage: (message) => {
      if (message.t === 'book' || message.t === 'book-sheet') outbox.characterChanged();
      assets.receive(message);
      if (message.t === 'log' || message.t === 'log-entry' || message.t === 'log-remove' || message.t === 'chat-refused' || message.t === 'people') log.receive(message);
      for (const listener of listeners) listener(message);
    },
  });
  const unsubscribe = store.subscribe((state, previous) => {
    assets.setAuthorized(referencedAssets({ scene: state.scene, book: state.book, log: state.log, shown: state.shownImage }));
    if (state.generation !== previous.generation) outbox.sceneChanged(state.scene?.scene.id ?? null);
  });
  return {
    table, store, identity, log, assets, send,
    join(input: { readonly name: string; readonly code?: string }): void { name = input.name; connection.start(input); },
    subscribe(listener: (message: GmMessage) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    leave(): Promise<void> { return connection.leaveAndForget(); },
    stop(): void { unsubscribe(); connection.stop(); outbox.clear(); assets.resetTransport(); router.destroy(); listeners.clear(); },
  };
}
