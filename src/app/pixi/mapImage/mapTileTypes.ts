import type { Pyramid, TileRef } from './pyramid.ts';
import type { TileSource } from './tileRequests.ts';

export interface OpenedPyramid {
  readonly handle: number;
  readonly hash: string;
  readonly pyramid: Pyramid;
}

export interface MapTiles {
  readonly source: TileSource;
  readonly cacheable: boolean;
  overview(maxSide: number): Promise<ImageBitmap>;
  close(): void;
}

export interface TileReader {
  tile(handle: number, ref: TileRef, signal?: AbortSignal): Promise<ImageBitmap>;
  overview(handle: number, maxSide: number, signal?: AbortSignal): Promise<ImageBitmap>;
  close(handle: number): void;
}
