/**
 * What a table keeps in its object's SQLite storage (design 4.4.2). The schema is created by
 * `createSchema`, which only `TableObject.init` calls, so an object nobody made a table in (any
 * well-formed code reaches one) never holds a table. Every other function here assumes the schema
 * is there; callers ask `isInitialised` first.
 *
 * Names of connected players are not stored: they live in the sockets' attachments.
 */

/** The facts about the table itself. Later rules add their own keys. */
export type MetaKey = 'secret_hash' | 'code_hash' | 'host_key_hash' | 'created_at';

/** What the scheduler runs: `cleanup` ends a table nobody hosts. Later rules add their own kinds. */
export type EventKind = 'cleanup';

/** One future action of the table, due at a moment of the relay's clock (milliseconds). */
export interface StoredEvent {
  readonly kind: string;
  readonly subject: string;
  readonly due: number;
}

const SCHEMA: readonly string[] = [
  'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE players (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, last_seen INTEGER NOT NULL)',
  'CREATE TABLE knocks (id TEXT PRIMARY KEY, name TEXT NOT NULL, wait_hash TEXT, key_hash TEXT NOT NULL, state TEXT NOT NULL, due INTEGER NOT NULL)',
  'CREATE TABLE events (kind TEXT NOT NULL, subject TEXT NOT NULL, due INTEGER NOT NULL, PRIMARY KEY (kind, subject))',
];

/** Creates the table's schema. Throws when it exists; run it inside the transaction that fills it. */
export function createSchema(sql: SqlStorage): void {
  for (const statement of SCHEMA) sql.exec(statement);
}

/** Whether a table was made in this object, read without creating anything. */
export function isInitialised(sql: SqlStorage): boolean {
  return sql.exec("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
}

export function setMeta(sql: SqlStorage, key: MetaKey, value: string): void {
  sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}

/** The stored value, or null when the key was never set. */
export function getMeta(sql: SqlStorage, key: MetaKey): string | null {
  const rows = sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray();
  return rows[0]?.value ?? null;
}

/** Schedules an event, replacing the one of the same kind and subject. */
export function upsertEvent(sql: SqlStorage, event: StoredEvent): void {
  sql.exec('INSERT INTO events (kind, subject, due) VALUES (?, ?, ?) ON CONFLICT (kind, subject) DO UPDATE SET due = excluded.due', event.kind, event.subject, event.due);
}

/** Cancels the event of a kind and subject, whenever it is due. */
export function cancelEvent(sql: SqlStorage, kind: string, subject: string): void {
  sql.exec('DELETE FROM events WHERE kind = ? AND subject = ?', kind, subject);
}

/** Removes an event that ran, unless it was scheduled again for another moment meanwhile. */
export function removeEvent(sql: SqlStorage, event: StoredEvent): void {
  sql.exec('DELETE FROM events WHERE kind = ? AND subject = ? AND due = ?', event.kind, event.subject, event.due);
}

/** Moves an event whose handler failed to a later moment, unless it was cancelled or scheduled again meanwhile. */
export function postponeEvent(sql: SqlStorage, event: StoredEvent, due: number): void {
  sql.exec('UPDATE events SET due = ? WHERE kind = ? AND subject = ? AND due = ?', due, event.kind, event.subject, event.due);
}

/** The events due at `now` or before, in the order they run. */
export function dueEvents(sql: SqlStorage, now: number): StoredEvent[] {
  return sql.exec<{ kind: string; subject: string; due: number }>('SELECT kind, subject, due FROM events WHERE due <= ? ORDER BY due, kind, subject', now).toArray();
}

/** The moment of the earliest event, or null when none is scheduled. */
export function earliestDue(sql: SqlStorage): number | null {
  const rows = sql.exec<{ due: number | null }>('SELECT MIN(due) AS due FROM events').toArray();
  return rows[0]?.due ?? null;
}
