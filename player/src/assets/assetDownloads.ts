import { ASSET_CHUNK_BYTES, MAX_ASSET_BYTES, parseAsset, parseTextAsset, type AssetRef, type AssetVariant } from '../../../src/app/online/protocol/asset.ts';
import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { AssetDownloads as AssetDownloadsContract, ExploredMemoryKey, ExploredStore } from '../state/interfaces.ts';
import { openPlayerDatabase, type PlayerDatabase, type VariantRow } from '../storage/playerDatabase.ts';
import { playerText } from '../i18n.ts';

type DownloadWaiter = { readonly resolve: (blob: Blob) => void; readonly reject: (error: Error) => void };
interface Waiting { readonly ref: AssetRef; readonly maxSide?: number; readonly resolve: (blob: Blob) => void; readonly reject: (error: Error) => void; readonly waiters: DownloadWaiter[]; readonly expectedVariant?: AssetRef; readonly previousVariant?: string; retried: boolean }
interface Download extends Waiting {
  byteRef: AssetRef;
  width: number | null;
  height: number | null;
  count: number;
  prefixCount: number;
  readonly chunks: Map<number, Uint8Array>;
  readonly key: string;
  readonly generation: number;
  variantKnown: boolean;
  finishing: boolean;
  readonly buffered: { readonly hash: string; readonly index: number; readonly count: number; readonly chunk: Uint8Array }[];
  bufferedBytes: number;
}
export interface AssetDownloadsOptions {
  readonly send: (message: PlayerMessage) => boolean;
  readonly authorized?: (ref: AssetRef) => boolean;
  readonly indexedDB?: IDBFactory | null;
  readonly database?: PlayerDatabase;
  readonly onNotice?: (message: string) => void;
  readonly onFinished?: (hash: string, maxSide?: number) => void;
}
export interface AssetMetadata { readonly width: number; readonly height: number }

export class AssetDownloads implements AssetDownloadsContract {
  readonly exploredStore: ExploredStore;
  private readonly authorized = new Map<string, AssetRef>();
  private readonly queue: Waiting[] = [];
  private readonly active = new Map<string, Download>();
  private readonly resolving = new Map<string, Waiting>();
  private readonly settled = new WeakSet<Waiting>();
  private readonly metadata = new Map<string, AssetMetadata>();
  private readonly inUse = new Map<string, number>();
  private readonly pinnedByRequest = new Map<string, string[]>();
  private transportGeneration = 0;
  private readonly database: Promise<PlayerDatabase>;
  private readonly volatileAssets = new Map<string, Blob>();
  private readonly volatileExplored = new Map<string, { readonly key: ExploredMemoryKey; readonly png: Blob }>();
  private readonly exploredEpochs = new Map<string, number>();
  private readonly exploredDeleting = new Set<string>();
  private readonly exploredWrites = new Map<string, Set<Promise<void>>>();
  private evictionPending = false;
  private evictionAgain = false;
  private storageNoticeShown = false;
  private pumpQueue: Promise<void> = Promise.resolve();
  constructor(private readonly options: AssetDownloadsOptions) {
    this.database = options.database === undefined ? openPlayerDatabase(options.indexedDB) : Promise.resolve(options.database);
    void this.database.then((database) => {
      this.noticeStorage(database);
    });
    this.exploredStore = {
      get: async (key) => {
        const local = this.volatileExplored.get(this.exploredKey(key));
        if (local) return local.png;
        const database = await this.database;
        const row = await database.getExplored(this.exploredKey(key));
        this.noticeStorage(database);
        return row?.png ?? null;
      },
      writeEpoch: (key) => this.exploredEpochFor(key),
      put: (key, png, epoch) => this.putExplored(key, png, epoch),
      deleteFor: (table, player) => this.deleteExplored(table, player),
    };
  }

  resetTransport(): void {
    this.transportGeneration++;
    for (const pending of this.active.values()) {
      this.rejectWaiting(pending, new Error('Transport generation changed'));
    }
    this.active.clear();
    for (const pending of this.queue.splice(0)) {
      this.rejectWaiting(pending, new Error('Transport generation changed'));
    }
    for (const pending of this.resolving.values()) this.rejectWaiting(pending, new Error('Transport generation changed'));
    this.resolving.clear();
  }

  setAuthorized(refs: readonly AssetRef[]): void {
    this.authorized.clear();
    for (const ref of refs) this.authorized.set(ref.hash, ref);
    for (const [key, pending] of this.active) {
      if (!this.isAuthorized(pending.ref)) this.reject(key, new Error('Asset is no longer authorized'));
    }
    for (const [key, pending] of this.resolving) {
      if (!this.isAuthorized(pending.ref)) {
        this.resolving.delete(key);
        this.rejectWaiting(pending, new Error('Asset is no longer authorized'));
      }
    }
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (!this.isAuthorized(this.queue[index].ref)) this.rejectWaiting(this.queue.splice(index, 1)[0], new Error('Asset is no longer authorized'));
    }
  }

  request(ref: AssetRef, maxSide?: number): Promise<Blob> {
    if (parseAsset(ref) === null && parseTextAsset(ref) === null) return Promise.reject(new Error('Invalid asset reference'));
    if (!this.isAuthorized(ref)) return Promise.reject(new Error('Asset is not authorized in the current view'));
    if (maxSide !== undefined && (!Number.isSafeInteger(maxSide) || maxSide < 256 || maxSide > 16384)) return Promise.reject(new Error('Invalid image variant size'));
    return new Promise((resolve, reject) => {
      const key = this.requestKey(ref.hash, maxSide);
      const waiting: Waiting = { ref, ...(maxSide === undefined ? {} : { maxSide }), resolve, reject, waiters: [], retried: false };
      const active = this.active.get(key) ?? this.resolving.get(key);
      if (active) active.waiters.push({ resolve, reject });
      else {
        const queued = this.queue.find((item) => this.requestKey(item.ref.hash, item.maxSide) === key);
        if (queued) queued.waiters.push({ resolve, reject });
        else this.queue.push(waiting);
      }
      void this.pump();
    });
  }

  receive(message: GmMessage): void {
    if (message.t === 'asset-variant') {
      void this.receiveVariant(message).catch(() => this.options.onNotice?.(playerText('assetCacheUnavailable')));
      return;
    }
    if (message.t === 'asset-chunk') this.receiveChunk(message.hash, message.index, message.count, message.data);
    else if (message.t === 'asset-refused') {
      for (const [key, pending] of this.active) if (message.hash === pending.ref.hash || message.hash === pending.byteRef.hash) this.reject(key, new Error('Asset unavailable'));
    }
  }

  metadataFor(ref: AssetRef, maxSide?: number): AssetMetadata | null {
    const metadata = this.metadata.get(this.requestKey(ref.hash, maxSide));
    return metadata ?? null;
  }

  release(hash: string, maxSide?: number): void {
    const requestKey = this.requestKey(hash, maxSide);
    const pinned = this.pinnedByRequest.get(requestKey);
    const actualHash = pinned?.shift();
    if (actualHash === undefined) return;
    if (pinned?.length === 0) this.pinnedByRequest.delete(requestKey);
    const count = this.inUse.get(actualHash) ?? 0;
    if (count <= 1) this.inUse.delete(actualHash);
    else this.inUse.set(actualHash, count - 1);
    this.scheduleEviction();
  }

  async clearExplored(table: string, player: string): Promise<void> {
    await this.exploredStore.deleteFor(table, player);
  }
  private exploredOwner(table: string, player: string): string { return JSON.stringify([table, player]); }
  private exploredEpochFor(key: ExploredMemoryKey): number {
    return this.exploredEpochs.get(this.exploredOwner(key.table, key.player)) ?? 0;
  }
  private async putExplored(key: ExploredMemoryKey, png: Blob, epoch: number): Promise<void> {
    const owner = this.exploredOwner(key.table, key.player);
    if (this.exploredDeleting.has(owner) || this.exploredEpochFor(key) !== epoch) return;
    const id = this.exploredKey(key);
    const cached = { key, png };
    this.volatileExplored.set(id, cached);
    const write = (async (): Promise<void> => {
      try {
        const database = await this.database;
        if (this.exploredDeleting.has(owner) || this.exploredEpochFor(key) !== epoch) {
          if (this.volatileExplored.get(id) === cached) this.volatileExplored.delete(id);
          return;
        }
        await database.putExplored({ ...key, key: id, png });
        if (this.volatileExplored.get(id) === cached) this.volatileExplored.delete(id);
      } catch { this.options.onNotice?.(playerText('memoryLost')); }
    })();
    const writes = this.exploredWrites.get(owner) ?? new Set<Promise<void>>();
    writes.add(write);
    this.exploredWrites.set(owner, writes);
    try { await write; }
    finally {
      writes.delete(write);
      if (writes.size === 0) this.exploredWrites.delete(owner);
    }
  }
  private async deleteExplored(table: string, player: string): Promise<void> {
    const owner = this.exploredOwner(table, player);
    this.exploredEpochs.set(owner, (this.exploredEpochs.get(owner) ?? 0) + 1);
    this.exploredDeleting.add(owner);
    for (const [id, row] of this.volatileExplored) if (row.key.table === table && row.key.player === player) this.volatileExplored.delete(id);
    try {
      await Promise.all(this.exploredWrites.get(owner) ?? []);
      await (await this.database).deleteExplored(table, player);
    } finally { this.exploredDeleting.delete(owner); }
  }

  private pump(): Promise<void> {
    const task = this.pumpQueue.then(() => this.fillQueue());
    this.pumpQueue = task.catch(() => undefined);
    return task;
  }

  private async fillQueue(): Promise<void> {
    while (this.active.size < 2 && this.queue.length > 0) {
      const pending = this.queue.shift();
      if (pending === undefined) return;
      const generation = this.transportGeneration;
      if (!this.isAuthorized(pending.ref)) { this.rejectWaiting(pending, new Error('Asset is no longer authorized')); continue; }
      const key = this.requestKey(pending.ref.hash, pending.maxSide);
      this.resolving.set(key, pending);
      try {
        const db = await this.database;
        const variant = pending.maxSide === undefined ? null : await db.getVariant(key);
        const assetHash = variant?.byteHash ?? pending.ref.hash;
        const local = this.volatileAssets.get(assetHash);
        if (local) {
          if (this.settled.has(pending) || generation !== this.transportGeneration || !this.isAuthorized(pending.ref)) { this.rejectWaiting(pending, new Error('Asset is no longer authorized')); continue; }
          this.volatileAssets.delete(assetHash);
          this.volatileAssets.set(assetHash, local);
          this.resolveWaiting(pending, local, assetHash);
          continue;
        }
        const cached = await db.getAsset(assetHash);
        this.noticeStorage(db);
        if (this.settled.has(pending) || generation !== this.transportGeneration || !this.isAuthorized(pending.ref)) { this.rejectWaiting(pending, new Error('Asset is no longer authorized')); continue; }
        if (cached && cached.size === (variant?.byteSize ?? pending.ref.size) && cached.blob.size === cached.size && cached.mime === (variant?.mime ?? pending.ref.mime) && cached.size <= MAX_ASSET_BYTES) {
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await cached.blob.arrayBuffer()));
          const actual = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
          if (this.settled.has(pending) || generation !== this.transportGeneration || !this.isAuthorized(pending.ref)) { this.rejectWaiting(pending, new Error('Asset is no longer authorized')); continue; }
          if (actual === assetHash) {
            if (variant) this.metadata.set(key, { width: variant.width, height: variant.height });
            void db.putAsset({ ...cached, usedAt: Date.now() }).catch(() => this.options.onNotice?.(playerText('assetCacheUnavailable')));
            this.resolveWaiting(pending, cached.blob, assetHash);
            continue;
          }
          await db.deleteAsset(assetHash);
        }
        if (this.settled.has(pending) || generation !== this.transportGeneration || !this.isAuthorized(pending.ref)) { this.rejectWaiting(pending, new Error('Asset is no longer authorized')); continue; }
        const byteRef = variant ? { hash: variant.byteHash, size: variant.byteSize, mime: variant.mime } : pending.ref;
        const count = Math.ceil(byteRef.size / ASSET_CHUNK_BYTES);
        const download: Download = {
          ...pending, generation, byteRef, width: variant?.width ?? null, height: variant?.height ?? null,
          count, prefixCount: 0, chunks: new Map(), key, variantKnown: pending.maxSide === undefined, finishing: false, buffered: [], bufferedBytes: 0,
        };
        this.active.set(key, download);
        this.resolving.delete(key);
        const partial = await db.getPartial(key);
        if (partial && partial.originalHash === pending.ref.hash && partial.maxSide === (pending.maxSide ?? 0) && partial.byteHash === byteRef.hash && partial.byteSize === byteRef.size && partial.chunkCount === count && Number.isSafeInteger(partial.prefixCount) && partial.prefixCount >= 0 && partial.prefixCount <= count) {
          const prefix = new Uint8Array(await partial.prefix.arrayBuffer());
          const expectedPrefix = partial.prefixCount === count ? byteRef.size : partial.prefixCount * ASSET_CHUNK_BYTES;
          if (prefix.byteLength === expectedPrefix) {
            for (let index = 0; index < partial.prefixCount; index++) {
              const start = index * ASSET_CHUNK_BYTES;
              download.chunks.set(index, prefix.slice(start, Math.min(prefix.length, start + ASSET_CHUNK_BYTES)));
            }
            download.prefixCount = partial.prefixCount;
          } else { download.retried = true; await db.deletePartial(key); }
        } else if (partial) { download.retried = true; await db.deletePartial(key); }
        if (this.active.get(key) !== download || !this.isAuthorized(download.ref)) continue;
        const request: PlayerMessage = { t: 'asset-request', hash: pending.ref.hash, ...(download.prefixCount > 0 ? { from: download.prefixCount } : {}), ...(pending.maxSide === undefined ? {} : { maxSide: pending.maxSide }) };
        if (!this.options.send(request)) this.reject(key, new Error('Asset request could not be sent'));
        else if (download.chunks.size === count && download.variantKnown) {
          download.finishing = true;
          void this.finish(download);
        }
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Asset download failed');
        if (this.active.has(key)) this.reject(key, failure);
        else this.rejectWaiting(pending, failure);
      }
      finally {
        if (this.resolving.get(key) === pending) this.resolving.delete(key);
      }
    }
  }

  private async receiveVariant(message: AssetVariant): Promise<void> {
    const key = this.requestKey(message.hash, message.maxSide);
    const download = this.active.get(key);
    if (!download || !this.isAuthorized(download.ref)) return;
    if (message.variant.size > MAX_ASSET_BYTES) { this.reject(key, new Error('Asset exceeds the download limit')); return; }
    const count = Math.ceil(message.variant.size / ASSET_CHUNK_BYTES);
    const matches = (ref: AssetRef): boolean => ref.hash === message.variant.hash && ref.size === message.variant.size && ref.mime === message.variant.mime;
    if (download.expectedVariant && !matches(download.expectedVariant)) {
      if (message.variant.hash !== download.previousVariant) this.reject(key, new Error('Image variant changed repeatedly'));
      return;
    }
    if ((download.prefixCount > 0 || download.variantKnown) && (!matches(download.byteRef) || download.count !== count)) {
      await this.restartFromZero(download, message.variant);
      return;
    }
    download.byteRef = message.variant;
    download.count = count;
    download.variantKnown = true;
    download.width = message.width;
    download.height = message.height;
    this.metadata.set(key, { width: message.width, height: message.height });
    const record: VariantRow = { key, originalHash: message.hash, maxSide: message.maxSide, byteHash: message.variant.hash, byteSize: message.variant.size, mime: message.variant.mime, width: message.width, height: message.height };
    void this.database.then((database) => database.putVariant(record)).catch(() => this.options.onNotice?.(playerText('memoryLost')));
    const buffered = download.buffered.splice(0);
    download.bufferedBytes = 0;
    for (const chunk of buffered) {
      if (chunk.hash === message.variant.hash && this.active.get(key) === download) this.acceptChunk(download, chunk.index, chunk.count, chunk.chunk);
    }
    if (download.chunks.size === count && !download.finishing) {
      download.finishing = true;
      await this.finish(download);
    }
  }

  private async restartFromZero(download: Download, expectedVariant?: AssetRef): Promise<void> {
    if (this.active.get(download.key) !== download) return;
    if (download.retried) { this.reject(download.key, new Error('Image variant changed repeatedly')); return; }
    this.active.delete(download.key);
    this.resolving.set(download.key, download);
    try {
      const database = await this.database;
      await database.deletePartial(download.key);
      await database.deleteVariant(download.key);
    } catch {
      if (this.resolving.get(download.key) === download) this.resolving.delete(download.key);
      this.rejectWaiting(download, new Error('The invalid asset prefix could not be discarded'));
      void this.pump();
      return;
    }
    if (this.resolving.get(download.key) === download) this.resolving.delete(download.key);
    this.metadata.delete(download.key);
    if (this.settled.has(download) || download.generation !== this.transportGeneration || !this.isAuthorized(download.ref)) {
      this.rejectWaiting(download, new Error('Asset is no longer authorized'));
      return;
    }
    const { ref, maxSide, resolve, reject, waiters } = download;
    this.queue.unshift({ ref, ...(maxSide === undefined ? {} : { maxSide }), resolve, reject, waiters, retried: true, ...(expectedVariant ? { expectedVariant, previousVariant: download.byteRef.hash } : {}) });
    void this.pump();
  }

  private receiveChunk(hash: string, index: number, count: number, encoded: string): void {
    let binary: string;
    try { binary = atob(encoded); } catch { return; }
    const chunk = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset++) chunk[offset] = binary.charCodeAt(offset);
    for (const download of this.active.values()) {
      if (!download.variantKnown && hash === download.ref.hash && (!download.expectedVariant || download.expectedVariant.hash === hash)) {
        if (download.prefixCount > 0 && download.byteRef.hash !== hash) {
          void this.restartFromZero(download, download.ref);
          continue;
        }
        download.byteRef = download.ref;
        download.count = Math.ceil(download.ref.size / ASSET_CHUNK_BYTES);
        download.variantKnown = true;
      }
      if (!download.variantKnown) {
        if (download.bufferedBytes + chunk.byteLength > MAX_ASSET_BYTES) { this.reject(download.key, new Error('Asset buffer exceeds the download limit')); continue; }
        download.buffered.push({ hash, index, count, chunk });
        download.bufferedBytes += chunk.byteLength;
      } else if (download.byteRef.hash === hash) this.acceptChunk(download, index, count, chunk);
    }
  }

  private acceptChunk(download: Download, index: number, count: number, chunk: Uint8Array): void {
    if (this.active.get(download.key) !== download || download.finishing) return;
    if (!this.isAuthorized(download.ref)) return;
    if (count !== download.count || index < 0 || index >= count) { void this.restartFromZero(download); return; }
    const expected = index === count - 1 ? download.byteRef.size - index * ASSET_CHUNK_BYTES : ASSET_CHUNK_BYTES;
    if (chunk.length !== expected) { this.reject(download.key, new Error('Invalid asset chunk size')); return; }
    const prior = download.chunks.get(index);
    if (prior !== undefined) {
      if (!this.sameBytes(prior, chunk)) this.reject(download.key, new Error('Conflicting asset chunk'));
      return;
    }
    download.chunks.set(index, chunk);
    const persisted = this.persistPrefix(download).catch(() => {
      this.options.onNotice?.(playerText('assetProgressLost'));
    });
    void persisted.then(() => {
      if (download.chunks.size === count && !download.finishing) {
        download.finishing = true;
        return this.finish(download);
      }
      return undefined;
    }).catch((error: unknown) => {
      if (this.active.get(download.key) === download) this.reject(download.key, error instanceof Error ? error : new Error('Asset integrity check failed'));
    });
  }

  private async persistPrefix(download: Download): Promise<void> {
    let prefixCount = 0;
    let size = 0;
    for (let index = 0; index < download.count; index++) {
      const chunk = download.chunks.get(index);
      if (!chunk) break;
      prefixCount++;
      size += chunk.length;
    }
    if (prefixCount === 0) return;
    download.prefixCount = prefixCount;
    const pieces: BlobPart[] = [];
    for (let index = 0; index < prefixCount; index++) {
      const chunk = download.chunks.get(index);
      if (chunk) pieces.push(chunk);
    }
    const prefix = new Blob(pieces);
    if (prefix.size !== size) return;
    if (this.active.get(download.key) !== download || !this.isAuthorized(download.ref)) return;
    await (await this.database).putPartial({ key: download.key, originalHash: download.ref.hash, maxSide: download.maxSide ?? 0, byteHash: download.byteRef.hash, byteSize: download.byteRef.size, chunkCount: download.count, prefixCount, prefix });
  }

  private async finish(download: Download): Promise<void> {
    const bytes = new Uint8Array(download.byteRef.size);
    let offset = 0;
    for (let index = 0; index < download.count; index++) {
      const chunk = download.chunks.get(index);
      if (chunk === undefined) return;
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    if (actual !== download.byteRef.hash) { await this.restartFromZero(download); return; }
    const blob = new Blob([bytes], { type: download.byteRef.mime });
    if (this.active.get(download.key) !== download) return;
    if (this.active.get(download.key) !== download || !this.isAuthorized(download.ref)) {
      this.reject(download.key, new Error('Asset is no longer authorized'));
      return;
    }
    let database: PlayerDatabase | null = null;
    try {
      database = await this.database;
      await database.putAsset({ hash: download.byteRef.hash, mime: download.byteRef.mime, size: blob.size, blob, usedAt: Date.now() });
      await database.deletePartial(download.key);
    } catch {
      this.volatileAssets.set(download.byteRef.hash, blob);
      this.options.onNotice?.(playerText('assetCacheFull'));
    }
    if (this.active.get(download.key) !== download) return;
    if (this.active.get(download.key) !== download || !this.isAuthorized(download.ref)) {
      this.reject(download.key, new Error('Asset is no longer authorized'));
      return;
    }
    if (download.width !== null && download.height !== null) this.metadata.set(download.key, { width: download.width, height: download.height });
    this.active.delete(download.key);
    this.resolveWaiting(download, blob, download.byteRef.hash);
    void this.pump();
  }

  private noticeStorage(database: PlayerDatabase): void {
    if (database.persistent || this.storageNoticeShown) return;
    this.storageNoticeShown = true;
    this.options.onNotice?.(playerText('assetStorageLost'));
  }

  private scheduleEviction(): void {
    if (this.evictionPending) { this.evictionAgain = true; return; }
    this.evictionPending = true;
    void this.database.then((database) => this.evict(database))
      .catch(() => this.options.onNotice?.(playerText('assetCacheUnavailable')))
      .finally(() => {
        this.evictionPending = false;
        if (this.evictionAgain) { this.evictionAgain = false; this.scheduleEviction(); }
      });
  }

  private async evict(database: PlayerDatabase): Promise<void> {
    const stored = await database.allAssets();
    const rows = new Map(stored.map((row) => [row.hash, { hash: row.hash, size: row.size, usedAt: row.usedAt }]));
    for (const [hash, blob] of this.volatileAssets) if (!rows.has(hash)) rows.set(hash, { hash, size: blob.size, usedAt: 0 });
    const ordered = [...rows.values()].sort((a, b) => a.usedAt - b.usedAt);
    const estimate = typeof navigator === 'undefined' || !navigator.storage?.estimate ? null : await navigator.storage.estimate().catch(() => null);
    const budget = Math.min(512 * 1024 * 1024, Math.floor((estimate?.quota ?? 5 * 1024 * 1024 * 1024) * 0.1));
    let total = ordered.reduce((sum, row) => sum + row.size, 0);
    for (const row of ordered) {
      if (total <= budget) break;
      if ((this.inUse.get(row.hash) ?? 0) > 0) continue;
      await database.deleteAsset(row.hash);
      this.volatileAssets.delete(row.hash);
      total -= row.size;
    }
  }

  private reject(key: string, error: Error): void {
    const download = this.active.get(key);
    if (!download) return;
    this.active.delete(key);
    void this.database.then((db) => db.deletePartial(key)).catch(() => this.options.onNotice?.(playerText('memoryLost')));
    this.rejectWaiting(download, error);
    void this.pump();
  }

  private rejectWaiting(waiting: Waiting, error: Error): void {
    if (this.settled.has(waiting)) return;
    this.settled.add(waiting);
    this.options.onFinished?.(waiting.ref.hash, waiting.maxSide);
    waiting.reject(error);
    for (const waiter of waiting.waiters) waiter.reject(error);
  }

  private resolveWaiting(waiting: Waiting, blob: Blob, byteHash: string): void {
    if (this.settled.has(waiting)) return;
    this.settled.add(waiting);
    this.options.onFinished?.(waiting.ref.hash, waiting.maxSide);
    this.pinFor(this.requestKey(waiting.ref.hash, waiting.maxSide), byteHash);
    waiting.resolve(blob);
    for (const waiter of waiting.waiters) {
      this.pinFor(this.requestKey(waiting.ref.hash, waiting.maxSide), byteHash);
      waiter.resolve(blob);
    }
    this.scheduleEviction();
  }

  private isAuthorized(ref: AssetRef): boolean {
    const authorized = this.authorized.get(ref.hash);
    return this.options.authorized?.(ref) ?? (authorized !== undefined && authorized.size === ref.size && authorized.mime === ref.mime);
  }

  private pinFor(requestHash: string, byteHash: string): void {
    this.inUse.set(byteHash, (this.inUse.get(byteHash) ?? 0) + 1);
    const pins = this.pinnedByRequest.get(requestHash) ?? [];
    pins.push(byteHash);
    this.pinnedByRequest.set(requestHash, pins);
  }

  private requestKey(hash: string, maxSide?: number): string { return `${hash}|${maxSide ?? 0}`; }

  private exploredKey(key: ExploredMemoryKey): string {
    return JSON.stringify([key.table, key.player, key.memoryId, key.mapHash, key.geometry]);
  }

  private sameBytes(first: Uint8Array, second: Uint8Array): boolean {
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) return false;
    return true;
  }
}
