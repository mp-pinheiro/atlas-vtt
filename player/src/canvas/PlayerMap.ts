import { Container, type Ticker } from 'pixi.js';
import { MapImageLayer } from '../../../src/app/pixi/mapImage/MapImageLayer.ts';
import { pyramidOf, tileSourceRect, type Pyramid, type TileRef } from '../../../src/app/pixi/mapImage/pyramid.ts';
import { TileTextureCache, type TileUploader } from '../../../src/app/pixi/mapImage/tileTextureCache.ts';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree.ts';
import PlayerMapWorker from './playerMapWorker.ts?worker&inline';
import type { PlayerMapWorkerRequest, PlayerMapWorkerResponse } from './playerMapWorkerProtocol.ts';

interface PendingBitmap {
  readonly resolve: (bitmap: ImageBitmap) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
}

export interface PlayerMapOptions {
  readonly blob: Blob;
  readonly byteHash: string;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly ticker: Ticker;
  readonly renderer: TileUploader | null;
  readonly requestRender: () => void;
  readonly onUnavailable: (error: Error) => void;
}

export class PlayerMap {
  readonly container = new Container({ label: 'player-map' });
  private readonly worker = new PlayerMapWorker();
  private readonly cache: TileTextureCache;
  private readonly generation = 1;
  private readonly pending = new Map<number, PendingBitmap>();
  private nextId = 1;
  private layer: MapImageLayer | null = null;
  private destroyed = false;
  private pyramid: Pyramid | null = null;
  private readonly ready: Promise<void>;
  private openResolve: (() => void) | null = null;
  private openReject: ((error: Error) => void) | null = null;
  private failure: Error | null = null;
  get key(): string { return this.options.byteHash; }

  constructor(private readonly options: PlayerMapOptions) {
    this.cache = new TileTextureCache({ ticker: options.ticker, renderer: options.renderer, requestRender: options.requestRender });
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onError);
    this.worker.addEventListener('messageerror', this.onError);
    this.ready = this.open();
  }

  async update(view: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly worldPerScreenPixel: number }): Promise<void> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.destroyed || !this.layer) return;
    this.layer.setCamera(() => ({ rect: { x: view.x, y: view.y, width: view.width, height: view.height }, worldPerScreenPixel: view.worldPerScreenPixel }));
  }

  async overview(maxSide: number): Promise<ImageBitmap> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.destroyed) throw new Error('Map image was closed.');
    const id = this.nextId++;
    return new Promise<ImageBitmap>((resolve, reject) => {
      const abort = (): void => {
        this.pending.delete(id);
        this.worker.postMessage({ type: 'cancel', generation: this.generation, id } satisfies PlayerMapWorkerRequest);
        reject(new Error('Map overview request was cancelled.'));
      };
      const controller = new AbortController();
      controller.signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        signal: controller.signal,
        abort,
      });
      this.worker.postMessage({ type: 'overview', generation: this.generation, id, maxSide } satisfies PlayerMapWorkerRequest);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.openReject?.(new Error('Map image was closed.'));
    this.layer?.destroy();
    this.layer = null;
    this.worker.postMessage({ type: 'close', generation: this.generation } satisfies PlayerMapWorkerRequest);
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onError);
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
      pending.reject(new Error('Map image was closed.'));
    }
    this.pending.clear();
    this.cache.destroy();
    destroyTree(this.container);
    this.options.requestRender();
  }

  private async open(): Promise<void> {
    try {
      const bytes = await this.options.blob.arrayBuffer();
      if (this.destroyed) return;
      const opened = new Promise<void>((resolve, reject) => {
        this.openResolve = resolve;
        this.openReject = reject;
      });
      this.worker.postMessage({ type: 'open', generation: this.generation, bytes, originalWidth: this.options.originalWidth, originalHeight: this.options.originalHeight, byteHash: this.options.byteHash } satisfies PlayerMapWorkerRequest, [bytes]);
      await opened;
      if (this.destroyed || !this.pyramid) return;
      const source = {
        key: this.options.byteHash,
        pyramid: this.pyramid,
        requestTile: (ref: TileRef, signal: AbortSignal): Promise<ImageBitmap> => this.requestTile(ref, signal),
      };
      this.layer = new MapImageLayer({ source, cache: this.cache, ticker: this.options.ticker, requestRender: this.options.requestRender, onTileError: (_ref, error) => this.options.onUnavailable(asError(error)) });
      this.container.addChild(this.layer.container);
      this.options.requestRender();
    } catch (error) {
      this.failure = asError(error);
      if (!this.destroyed) this.options.onUnavailable(this.failure);
    }
  }

  private requestTile(ref: TileRef, signal: AbortSignal): Promise<ImageBitmap> {
    const pyramid = this.pyramid;
    if (this.destroyed || !pyramid) return Promise.reject(new Error('Map image is not available.'));
    if (!pyramid.levels[ref.level]) return Promise.reject(new Error('Map tile level is invalid.'));
    if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Map tile request aborted'));
    const rect = tileSourceRect(pyramid, ref);
    const id = this.nextId++;
    return new Promise<ImageBitmap>((resolve, reject) => {
      const abort = (): void => {
        this.pending.delete(id);
        this.worker.postMessage({ type: 'cancel', generation: this.generation, id } satisfies PlayerMapWorkerRequest);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Tile request cancelled.', 'AbortError'));
      };
      this.pending.set(id, { resolve, reject, signal, abort });
      signal.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ type: 'tile', generation: this.generation, id, ref, rect, width: rect.width, height: rect.height } satisfies PlayerMapWorkerRequest);
    });
  }

  private readonly onError = (): void => {
    const error = this.failure = new Error('The map image worker stopped.');
    this.openReject?.(error);
    for (const pending of this.pending.values()) {
      if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.destroyed) this.options.onUnavailable(error);
  };
  private readonly onMessage = (event: MessageEvent<PlayerMapWorkerResponse>): void => {
    const message = event.data;
    if (message.generation !== this.generation || this.destroyed) {
      if (message.type === 'bitmap') message.bitmap.close();
      return;
    }
    if (message.type === 'opened') {
      if (message.byteHash !== this.options.byteHash) {
        this.openReject?.(new Error('Map image identity changed during decoding.'));
      } else {
        this.pyramid = pyramidOf(this.options.originalWidth, this.options.originalHeight, message.decodedScale);
        this.openResolve?.();
      }
      return;
    }
    if (message.type === 'failed') {
      const error = new Error(message.message);
      if (message.id === undefined) {
        this.openReject?.(error);
      } else {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (pending.signal !== undefined && pending.abort !== undefined) pending.signal.removeEventListener('abort', pending.abort);
          pending.reject(error);
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      message.bitmap.close();
      return;
    }
    this.pending.delete(message.id);
    if (pending.signal !== undefined && pending.abort !== undefined) pending.signal.removeEventListener('abort', pending.abort);
    pending.resolve(message.bitmap);
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
