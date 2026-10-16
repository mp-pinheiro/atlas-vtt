export interface TableConfig {
  readonly codeHash: string;
  readonly secretHash: string;
  readonly hostFingerprint: string;
  readonly createdAt: number;
}

export type PlayerRecord = { [key: string]: string | number; id: string; keyHash: string };
export type WaitingRecord = { [key: string]: string | number | null; id: string; name: string; waitHash: string; deadline: number; admitted: number; keyHash: string | null; activeGeneration: number | null };

export async function initializeTable(storage: DurableObjectStorage, config: TableConfig): Promise<void> {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS waiting (id TEXT PRIMARY KEY, name TEXT NOT NULL, wait_hash TEXT NOT NULL, deadline INTEGER NOT NULL, admitted INTEGER NOT NULL DEFAULT 0, key_hash TEXT, active_generation INTEGER)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS gate_failures (at INTEGER NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS active_players (id TEXT PRIMARY KEY, generation INTEGER NOT NULL)');
  for (const [key, value] of Object.entries(config)) storage.sql.exec('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', key, String(value));
  storage.sql.exec('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', 'ask', '1');
}

export function readMeta(storage: DurableObjectStorage, key: string): string | null {
  const row = storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
  return row?.value ?? null;
}

export function writeMeta(storage: DurableObjectStorage, key: string, value: string | null): void {
  if (value === null) storage.sql.exec('DELETE FROM meta WHERE key = ?', key);
  else storage.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
}

export function players(storage: DurableObjectStorage): PlayerRecord[] {
  return storage.sql.exec<PlayerRecord>('SELECT id, key_hash AS keyHash FROM players').toArray();
}

export function waiting(storage: DurableObjectStorage): WaitingRecord[] {
  return storage.sql.exec<WaitingRecord>('SELECT id, name, wait_hash AS waitHash, deadline, admitted, key_hash AS keyHash, active_generation AS activeGeneration FROM waiting').toArray();
}
