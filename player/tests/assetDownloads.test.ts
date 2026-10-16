import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { ASSET_CHUNK_BYTES, type AssetRef } from '../../src/app/online/protocol/asset.ts';
import type { GmMessage, PlayerMessage } from '../../src/app/online/protocol/game.ts';
import { AssetDownloads } from '../src/assets/assetDownloads.ts';
import { openPlayerDatabase } from '../src/storage/playerDatabase.ts';

interface Deferred<T> { readonly promise: Promise<T>; readonly resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolveValue = resolve; });
  return { promise, resolve: (value) => resolveValue(value) };
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('verified browser asset downloads', () => {
  it('waits for variant metadata and verifies the bytes before resolving', async () => {
    const bytes = new Uint8Array([11, 22, 33, 44, 55]);
    const ref: AssetRef = { hash: await hash(bytes), size: bytes.length, mime: 'image/png' };
    const requested = deferred<PlayerMessage>();
    const downloads = new AssetDownloads({
      indexedDB: null,
      send: (message) => { requested.resolve(message); return true; },
    });
    downloads.setAuthorized([ref]);
    const result = downloads.request(ref, 256);
    expect(await requested.promise).toEqual({ t: 'asset-request', hash: ref.hash, maxSide: 256 });
    const variant: GmMessage = { t: 'asset-variant', hash: ref.hash, maxSide: 256, variant: ref, width: 800, height: 400 };
    downloads.receive(variant);
    downloads.receive({ t: 'asset-chunk', hash: ref.hash, index: 0, count: 1, data: base64(bytes) });
    const blob = await result;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(downloads.metadataFor(ref, 256)).toEqual({ width: 800, height: 400 });
    downloads.release(ref.hash, 256);
  });

  it('refuses a reference removed from the current authorization set', async () => {
    const bytes = new Uint8Array([1]);
    const ref: AssetRef = { hash: await hash(bytes), size: 1, mime: 'image/png' };
    const send = vi.fn(() => true);
    const downloads = new AssetDownloads({ indexedDB: null, send });
    downloads.setAuthorized([ref]);
    downloads.setAuthorized([]);
    await expect(downloads.request(ref)).rejects.toThrow('not authorized');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('asset transfer resume', () => {
  it('persists a contiguous prefix and resumes from that chunk with the same tuple', async () => {
    const bytes = new Uint8Array(ASSET_CHUNK_BYTES + 3);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    const ref: AssetRef = { hash: await hash(bytes), size: bytes.length, mime: 'image/png' };
    const database = await openPlayerDatabase(null);
    const firstRequest = deferred<PlayerMessage>();
    const first = new AssetDownloads({ database, send: (message) => { firstRequest.resolve(message); return true; } });
    first.setAuthorized([ref]);
    first.request(ref).catch(() => undefined);
    expect(await firstRequest.promise).toEqual({ t: 'asset-request', hash: ref.hash });
    first.receive({ t: 'asset-chunk', hash: ref.hash, index: 0, count: 2, data: base64(bytes.slice(0, ASSET_CHUNK_BYTES)) });
    let partial = await database.getPartial(`${ref.hash}|0`);
    for (let attempt = 0; partial === null && attempt < 8; attempt++) {
      await Promise.resolve();
      partial = await database.getPartial(`${ref.hash}|0`);
    }
    expect(partial?.prefixCount).toBe(1);
    const resumeRequest = deferred<PlayerMessage>();
    const resumed = new AssetDownloads({ database, send: (message) => { resumeRequest.resolve(message); return true; } });
    resumed.setAuthorized([ref]);
    const result = resumed.request(ref);
    expect(await resumeRequest.promise).toEqual({ t: 'asset-request', hash: ref.hash, from: 1 });
    resumed.receive({ t: 'asset-chunk', hash: ref.hash, index: 1, count: 2, data: base64(bytes.slice(ASSET_CHUNK_BYTES)) });
    expect(new Uint8Array(await (await result).arrayBuffer())).toEqual(bytes);
  });
});

describe('variant and generation isolation', () => {
  it('buffers a variant chunk received before its authorization metadata', async () => {
    const bytes = new Uint8Array([3, 4, 5]);
    const original: AssetRef = { hash: 'a'.repeat(64), size: 100, mime: 'image/png' };
    const variant: AssetRef = { hash: await hash(bytes), size: bytes.length, mime: 'image/webp' };
    const requested = deferred<PlayerMessage>();
    const downloads = new AssetDownloads({ indexedDB: null, send: (message) => { requested.resolve(message); return true; } });
    downloads.setAuthorized([original]);
    let finished = false;
    const result = downloads.request(original, 256).then((blob) => { finished = true; return blob; });
    await requested.promise;
    downloads.receive({ t: 'asset-chunk', hash: variant.hash, index: 0, count: 1, data: base64(bytes) });
    await Promise.resolve();
    expect(finished).toBe(false);
    downloads.receive({ t: 'asset-variant', hash: original.hash, maxSide: 256, variant, width: 16000, height: 9000 });
    expect(new Uint8Array(await (await result).arrayBuffer())).toEqual(bytes);
    expect(downloads.metadataFor(original, 256)).toEqual({ width: 16000, height: 9000 });
  });

  it('discards an old resumed variant, restarts once, and never combines old and new bytes', async () => {
    const oldBytes = new Uint8Array(ASSET_CHUNK_BYTES + 1).fill(7);
    const newBytes = new Uint8Array([9, 8, 7]);
    const original: AssetRef = { hash: 'b'.repeat(64), size: oldBytes.length + 100, mime: 'image/png' };
    const oldVariant: AssetRef = { hash: await hash(oldBytes), size: oldBytes.length, mime: 'image/webp' };
    const newVariant: AssetRef = { hash: await hash(newBytes), size: newBytes.length, mime: 'image/webp' };
    const database = await openPlayerDatabase(null);
    const key = `${original.hash}|256`;
    await database.putVariant({ key, originalHash: original.hash, maxSide: 256, byteHash: oldVariant.hash, byteSize: oldVariant.size, mime: oldVariant.mime, width: 4000, height: 3000 });
    await database.putPartial({ key, originalHash: original.hash, maxSide: 256, byteHash: oldVariant.hash, byteSize: oldVariant.size, chunkCount: 2, prefixCount: 1, prefix: new Blob([oldBytes.slice(0, ASSET_CHUNK_BYTES)]) });
    const first = deferred<PlayerMessage>();
    const second = deferred<PlayerMessage>();
    let count = 0;
    const downloads = new AssetDownloads({ database, send: (message) => { (++count === 1 ? first : second).resolve(message); return true; } });
    downloads.setAuthorized([original]);
    const result = downloads.request(original, 256);
    expect(await first.promise).toMatchObject({ from: 1 });
    downloads.receive({ t: 'asset-variant', hash: original.hash, maxSide: 256, variant: newVariant, width: 4000, height: 3000 });
    expect(await second.promise).toEqual({ t: 'asset-request', hash: original.hash, maxSide: 256 });
    downloads.receive({ t: 'asset-variant', hash: original.hash, maxSide: 256, variant: oldVariant, width: 4000, height: 3000 });
    downloads.receive({ t: 'asset-chunk', hash: oldVariant.hash, index: 1, count: 2, data: base64(oldBytes.slice(ASSET_CHUNK_BYTES)) });
    downloads.receive({ t: 'asset-chunk', hash: newVariant.hash, index: 0, count: 1, data: base64(newBytes) });
    downloads.receive({ t: 'asset-variant', hash: original.hash, maxSide: 256, variant: newVariant, width: 4000, height: 3000 });
    expect(new Uint8Array(await (await result).arrayBuffer())).toEqual(newBytes);
    expect(count).toBe(2);
  });

  it('rejects a repeatedly invalid digest rather than decoding fabricated bytes', async () => {
    const bytes = new Uint8Array([5, 6]);
    const ref: AssetRef = { hash: await hash(bytes), size: 2, mime: 'image/png' };
    const first = deferred<PlayerMessage>();
    const second = deferred<PlayerMessage>();
    let requests = 0;
    const downloads = new AssetDownloads({ indexedDB: null, send: (message) => { (++requests === 1 ? first : second).resolve(message); return true; } });
    downloads.setAuthorized([ref]);
    const result = downloads.request(ref);
    const failure = expect(result).rejects.toThrow('repeatedly');
    await first.promise;
    const invalid: GmMessage = { t: 'asset-chunk', hash: ref.hash, index: 0, count: 1, data: base64(new Uint8Array([6, 5])) };
    downloads.receive(invalid);
    await second.promise;
    downloads.receive(invalid);
    await failure;
    expect(requests).toBe(2);
  });

  it('invalidates pending asynchronous cache reads on transport replacement', async () => {
    const database = await openPlayerDatabase(null);
    const gate = deferred<null>();
    const entered = deferred<void>();
    const send = vi.fn(() => true);
    const ref: AssetRef = { hash: 'c'.repeat(64), size: 1, mime: 'image/png' };
    const downloads = new AssetDownloads({ database: { ...database, getAsset: async () => { entered.resolve(); return gate.promise; } }, send });
    downloads.setAuthorized([ref]);
    const result = downloads.request(ref);
    const failed = expect(result).rejects.toBeInstanceOf(Error);
    await entered.promise;
    downloads.resetTransport();
    gate.resolve(null);
    await failed;
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a quota-failed verified asset in memory without downloading it again', async () => {
    const bytes = new Uint8Array([1, 3, 5]);
    const ref: AssetRef = { hash: await hash(bytes), size: bytes.length, mime: 'image/png' };
    const database = await openPlayerDatabase(null);
    const requested = deferred<PlayerMessage>();
    const send = vi.fn((message: PlayerMessage) => { requested.resolve(message); return true; });
    const notice = vi.fn();
    const downloads = new AssetDownloads({ database: { ...database, putAsset: async () => { throw new DOMException('full', 'QuotaExceededError'); } }, send, onNotice: notice });
    downloads.setAuthorized([ref]);
    const first = downloads.request(ref);
    await requested.promise;
    downloads.receive({ t: 'asset-chunk', hash: ref.hash, index: 0, count: 1, data: base64(bytes) });
    expect(new Uint8Array(await (await first).arrayBuffer())).toEqual(bytes);
    expect(new Uint8Array(await (await downloads.request(ref)).arrayBuffer())).toEqual(bytes);
    expect(send).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalled();
  });

  it('forgets only this player personal memory and retains content-addressed assets', async () => {
    const database = await openPlayerDatabase(null);
    const downloads = new AssetDownloads({ database, send: () => true });
    const key = { table: 'table', player: 'alice', memoryId: 'a'.repeat(24), mapHash: 'a'.repeat(64), geometry: '[100,200]' };
    await downloads.exploredStore.put(key, new Blob(['alice']), downloads.exploredStore.writeEpoch(key));
    const bobKey = { ...key, player: 'bob' };
    await downloads.exploredStore.put(bobKey, new Blob(['bob']), downloads.exploredStore.writeEpoch(bobKey));
    const asset = new Blob(['art']);
    await database.putAsset({ hash: key.mapHash, mime: 'image/png', size: asset.size, blob: asset, usedAt: 1 });
    await downloads.clearExplored('table', 'alice');
    expect(await downloads.exploredStore.get(key)).toBeNull();
    expect(await (await downloads.exploredStore.get({ ...key, player: 'bob' }))?.text()).toBe('bob');
    expect(await database.getAsset(key.mapHash)).not.toBeNull();
  });
});

describe('download cache ownership', () => {
  it('coalesces requests while the first cache lookup is still awaiting storage', async () => {
    const bytes = new Uint8Array([2, 4, 6]);
    const ref: AssetRef = { hash: await hash(bytes), size: 3, mime: 'image/png' };
    const database = await openPlayerDatabase(null);
    const lookup = deferred<null>();
    const entered = deferred<void>();
    const requested = deferred<PlayerMessage>();
    const send = vi.fn((message: PlayerMessage) => { requested.resolve(message); return true; });
    const downloads = new AssetDownloads({ database: { ...database, getAsset: async () => { entered.resolve(); return lookup.promise; } }, send });
    downloads.setAuthorized([ref]);
    const first = downloads.request(ref);
    await entered.promise;
    const second = downloads.request(ref);
    lookup.resolve(null);
    await requested.promise;
    downloads.receive({ t: 'asset-chunk', hash: ref.hash, index: 0, count: 1, data: base64(bytes) });
    expect(await first).toBe(await second);
    expect(send).toHaveBeenCalledTimes(1);
    downloads.release(ref.hash);
    downloads.release(ref.hash);
  });

  it('never evicts an in-use blob and evicts it after its last release', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 20 }) } });
    try {
      const database = await openPlayerDatabase(null);
      const bytes = new Uint8Array([7, 8, 9]);
      const ref: AssetRef = { hash: await hash(bytes), size: 3, mime: 'image/png' };
      await database.putAsset({ hash: ref.hash, mime: ref.mime, size: 3, blob: new Blob([bytes]), usedAt: 0 });
      const deleted = deferred<void>();
      const downloads = new AssetDownloads({ database: { ...database, deleteAsset: async (hash) => { await database.deleteAsset(hash); deleted.resolve(); } }, send: () => true });
      downloads.setAuthorized([ref]);
      await downloads.request(ref);
      for (let turn = 0; turn < 12; turn++) await Promise.resolve();
      expect(await database.getAsset(ref.hash)).not.toBeNull();
      downloads.release(ref.hash);
      await deleted.promise;
      expect(await database.getAsset(ref.hash)).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects bad chunk geometry before any bytes can be decoded and restarts only once', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const ref: AssetRef = { hash: await hash(bytes), size: 3, mime: 'image/png' };
    const first = deferred<PlayerMessage>();
    const second = deferred<PlayerMessage>();
    let requests = 0;
    const downloads = new AssetDownloads({ indexedDB: null, send: (message) => { (++requests === 1 ? first : second).resolve(message); return true; } });
    downloads.setAuthorized([ref]);
    const result = downloads.request(ref);
    const failed = expect(result).rejects.toThrow('repeatedly');
    await first.promise;
    const invalid: GmMessage = { t: 'asset-chunk', hash: ref.hash, index: 0, count: 2, data: base64(bytes) };
    downloads.receive(invalid);
    await second.promise;
    downloads.receive(invalid);
    await failed;
    expect(requests).toBe(2);
  });
});
