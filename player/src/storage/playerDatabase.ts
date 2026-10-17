export const PLAYER_DATABASE = 'atlas-player';
export const PLAYER_DATABASE_VERSION = 1;
export type AssetRow = { readonly hash: string; readonly mime: string; readonly size: number; readonly blob: Blob; readonly usedAt: number };
export type PartialAssetRow = { readonly key: string; readonly originalHash: string; readonly maxSide: number; readonly byteHash: string; readonly byteSize: number; readonly chunkCount: number; readonly prefixCount: number; readonly prefix: Blob };
export type VariantRow = { readonly key: string; readonly originalHash: string; readonly maxSide: number; readonly byteHash: string; readonly byteSize: number; readonly mime: string; readonly width: number; readonly height: number };
export type ExploredRow = { readonly key: string; readonly table: string; readonly player: string; readonly memoryId: string; readonly mapHash: string; readonly geometry: string; readonly png: Blob };

export interface PlayerDatabase {
  readonly persistent: boolean;
  getAsset(hash: string): Promise<AssetRow | null>;
  putAsset(asset: AssetRow): Promise<void>;
  allAssets(): Promise<readonly AssetRow[]>;
  deleteAsset(hash: string): Promise<void>;
  getPartial(key: string): Promise<PartialAssetRow | null>;
  putPartial(partial: PartialAssetRow): Promise<void>;
  deletePartial(key: string): Promise<void>;
  getVariant(key: string): Promise<VariantRow | null>;
  putVariant(variant: VariantRow): Promise<void>;
  deleteVariant(key: string): Promise<void>;
  getExplored(key: string): Promise<ExploredRow | null>;
  putExplored(row: ExploredRow): Promise<void>;
  deleteExplored(table: string, player: string): Promise<void>;
}

export async function openPlayerDatabase(factory?: IDBFactory | null): Promise<PlayerDatabase> {
  try {
    if (factory === undefined) factory = globalThis.indexedDB ?? null;
    if (factory === null) return memoryDatabase();
    const selectedFactory = factory;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = selectedFactory.open(PLAYER_DATABASE, PLAYER_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'hash' });
        if (!db.objectStoreNames.contains('partialAssets')) db.createObjectStore('partialAssets', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('variants')) db.createObjectStore('variants', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('explored')) db.createObjectStore('explored', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Database could not be opened'));
      request.onblocked = () => reject(new Error('Database upgrade blocked'));
    });
    return resilientDatabase(indexedDatabase(database));
  } catch { return memoryDatabase(); }
}

function indexedDatabase(db: IDBDatabase): PlayerDatabase {
  const read = <T>(store: string, key: IDBValidKey): Promise<T | null> => new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Database read failed'));
  });
  const write = (store: string, value: unknown): Promise<void> => new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Database write failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Database write aborted'));
  });
  const remove = (store: string, key: IDBValidKey): Promise<void> => new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Database delete failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Database delete aborted'));
  });
  return {
    persistent: true,
    getAsset: (key) => read('assets', key),
    putAsset: (row) => write('assets', row),
    allAssets: () => new Promise((resolve, reject) => {
      const request = db.transaction('assets', 'readonly').objectStore('assets').getAll();
      request.onsuccess = () => resolve(request.result as AssetRow[]);
      request.onerror = () => reject(request.error ?? new Error('Database read failed'));
    }),
    deleteAsset: (key) => remove('assets', key),
    getPartial: (key) => read('partialAssets', key),
    putPartial: (row) => write('partialAssets', row),
    deletePartial: (key) => remove('partialAssets', key),
    getVariant: (key) => read('variants', key),
    putVariant: (row) => write('variants', row),
    deleteVariant: (key) => remove('variants', key),
    getExplored: (key) => read('explored', key),
    putExplored: (row) => write('explored', row),
    deleteExplored: (table, player) => new Promise((resolve, reject) => {
      const transaction = db.transaction('explored', 'readwrite');
      const request = transaction.objectStore('explored').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) return;
        const row = cursor.value as ExploredRow;
        if (row.table === table && row.player === player) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Database delete failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Database delete aborted'));
    }),
  };
}

function memoryDatabase(): PlayerDatabase {
  const assets = new Map<string, AssetRow>();
  const partials = new Map<string, PartialAssetRow>();
  const variants = new Map<string, VariantRow>();
  const explored = new Map<string, ExploredRow>();
  return {
    persistent: false,
    getAsset: async (key) => assets.get(key) ?? null,
    putAsset: async (row) => { assets.set(row.hash, row); },
    allAssets: async () => [...assets.values()],
    deleteAsset: async (key) => { assets.delete(key); },
    getPartial: async (key) => partials.get(key) ?? null,
    putPartial: async (row) => { partials.set(row.key, row); },
    deletePartial: async (key) => { partials.delete(key); },
    getVariant: async (key) => variants.get(key) ?? null,
    putVariant: async (row) => { variants.set(row.key, row); },
    deleteVariant: async (key) => { variants.delete(key); },
    getExplored: async (key) => explored.get(key) ?? null,
    putExplored: async (row) => { explored.set(row.key, row); },
    deleteExplored: async (table, player) => {
      for (const [key, row] of explored) if (row.table === table && row.player === player) explored.delete(key);
    },
  };
}

function resilientDatabase(disk: PlayerDatabase): PlayerDatabase {
  const memory = memoryDatabase();
  let persistent = true;
  const read = async <T>(local: () => Promise<T>, stored: () => Promise<T>): Promise<T> => {
    if (!persistent) return local();
    try { return await stored(); }
    catch { persistent = false; return local(); }
  };
  const write = async (local: () => Promise<void>, stored: () => Promise<void>): Promise<void> => {
    await local();
    if (!persistent) return;
    try { await stored(); }
    catch (error) { persistent = false; throw error; }
  };
  return {
    get persistent(): boolean { return persistent; },
    getAsset: (hash) => read(() => memory.getAsset(hash), () => disk.getAsset(hash)),
    putAsset: (row) => write(() => memory.putAsset(row), () => disk.putAsset(row)),
    allAssets: () => read(() => memory.allAssets(), () => disk.allAssets()),
    deleteAsset: (hash) => write(() => memory.deleteAsset(hash), () => disk.deleteAsset(hash)),
    getPartial: (key) => read(() => memory.getPartial(key), () => disk.getPartial(key)),
    putPartial: (row) => write(() => memory.putPartial(row), () => disk.putPartial(row)),
    deletePartial: (key) => write(() => memory.deletePartial(key), () => disk.deletePartial(key)),
    getVariant: (key) => read(() => memory.getVariant(key), () => disk.getVariant(key)),
    putVariant: (row) => write(() => memory.putVariant(row), () => disk.putVariant(row)),
    deleteVariant: (key) => write(() => memory.deleteVariant(key), () => disk.deleteVariant(key)),
    getExplored: (key) => read(() => memory.getExplored(key), () => disk.getExplored(key)),
    putExplored: (row) => write(() => memory.putExplored(row), () => disk.putExplored(row)),
    deleteExplored: (table, player) => write(() => memory.deleteExplored(table, player), () => disk.deleteExplored(table, player)),
  };
}
