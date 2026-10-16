import { DurableObject } from 'cloudflare:workers';

const CURRENT = 'current';

/**
 * Which table a host key made last. One object per host key (named by the key's SHA-256), holding
 * one row: the Durable Object id of that table. A table cannot find another table's object, so a
 * new table asks here for the one it replaces, and the Worker ends that one with `superseded`.
 * An object id is a one-way derivative of the table's code: the registry holds no code, secret or key.
 */
export class HostRegistry extends DurableObject {
  /** Records `tableId` as the host key's current table and answers the id of the one it replaces, or null when there was none. */
  replace(tableId: string): string | null {
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(() => {
      sql.exec('CREATE TABLE IF NOT EXISTS registry (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const previous = sql.exec<{ value: string }>('SELECT value FROM registry WHERE name = ?', CURRENT).toArray()[0]?.value ?? null;
      sql.exec('INSERT INTO registry (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', CURRENT, tableId);
      return previous;
    });
  }
}
