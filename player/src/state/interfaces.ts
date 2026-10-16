import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';

export interface ConnectionTimers {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
  random(): number;
}
export interface PlayerConnectionApi {
  start(input: { readonly name: string; readonly code?: string }): void;
  send(message: PlayerMessage): boolean;
  stop(): void;
  leaveAndForget(): Promise<void>;
}
export interface AssetDownloads {
  resetTransport(): void;
  setAuthorized(refs: readonly AssetRef[]): void;
  receive(message: GmMessage): void;
  request(ref: AssetRef, maxSide?: number): Promise<Blob>;
  metadataFor(ref: AssetRef, maxSide?: number): AssetMetadata | null;
  release(hash: string, maxSide?: number): void;
  clearExplored(table: string, player: string): Promise<void>;
  readonly exploredStore: ExploredStore;
}
export interface AssetMetadata { readonly width: number; readonly height: number }
export interface ExploredStore {
  get(key: ExploredMemoryKey): Promise<Blob | null>;
  writeEpoch(key: ExploredMemoryKey): number;
  put(key: ExploredMemoryKey, png: Blob, epoch: number): Promise<void>;
  deleteFor(table: string, player: string): Promise<void>;
}
export interface ExploredMemoryKey {
  readonly table: string;
  readonly player: string;
  readonly memoryId: string;
  readonly mapHash: string;
  readonly geometry: string;
}
