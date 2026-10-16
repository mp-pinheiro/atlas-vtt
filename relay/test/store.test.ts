import { evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { randomBase32, sha256Hex } from '../src/table/codec.ts';
import { cancelEvent, createSchema, dueEvents, earliestDue, getMeta, isInitialised, removeEvent, setMeta, upsertEvent } from '../src/table/store.ts';
import type { TableInit } from '../src/table/TableObject.ts';
import { failureOf, sqlRows, tableNames } from './helpers.ts';

afterEach(async () => {
  await reset();
});

async function validInit(): Promise<TableInit> {
  return { secretHash: await sha256Hex('secret'), codeHash: await sha256Hex('code'), hostKeyHash: await sha256Hex('key') };
}

/** The object of a code nobody made a table for: any well-formed code reaches one. */
function untouchedStub(): DurableObjectStub<import('../src/table/TableObject.ts').TableObject> {
  return env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
}

describe('before init', () => {
  it('holds no table, however the object is reached', async () => {
    const stub = untouchedStub();
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
  });

  it('holds no table and sets no alarm after the object is evicted and wakes again', async () => {
    const stub = untouchedStub();
    await stub.isInitialised();
    await evictDurableObject(stub);
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });
});

describe('init', () => {
  it('creates the four tables of the schema, and nothing else', async () => {
    const stub = untouchedStub();
    await stub.init(await validInit());
    expect(await stub.isInitialised()).toBe(true);
    expect(await tableNames(stub)).toEqual(['events', 'knocks', 'meta', 'players']);
  });

  it('gives the tables the columns of the design', async () => {
    const stub = untouchedStub();
    await stub.init(await validInit());
    const columns = async (table: string): Promise<string[]> => (await sqlRows(stub, `SELECT name FROM pragma_table_info('${table}') ORDER BY cid`)).map((row) => String(row.name));
    expect(await columns('meta')).toEqual(['key', 'value']);
    expect(await columns('players')).toEqual(['id', 'key_hash', 'last_seen']);
    expect(await columns('knocks')).toEqual(['id', 'name', 'wait_hash', 'key_hash', 'state', 'due']);
    expect(await columns('events')).toEqual(['kind', 'subject', 'due']);
  });

  it('keeps the three digests and the moment the table was made', async () => {
    const stub = untouchedStub();
    const input = await validInit();
    const before = Date.now();
    await stub.init(input);
    const rows = await sqlRows(stub, 'SELECT key, value FROM meta ORDER BY key');
    const meta = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
    expect(Object.keys(meta)).toEqual(['code_hash', 'created_at', 'host_key_hash', 'secret_hash']);
    expect(meta.secret_hash).toBe(input.secretHash);
    expect(meta.code_hash).toBe(input.codeHash);
    expect(meta.host_key_hash).toBe(input.hostKeyHash);
    expect(Number(meta.created_at)).toBeGreaterThanOrEqual(before);
    expect(Number(meta.created_at)).toBeLessThanOrEqual(Date.now());
  });

  it('throws when the table exists, and leaves it as it was', async () => {
    const stub = untouchedStub();
    const input = await validInit();
    await stub.init(input);
    expect(await failureOf(stub, (table) => table.init({ ...input, secretHash: 'a'.repeat(64) }))).toBe('This table exists already.');
    expect(await sqlRows(stub, "SELECT value FROM meta WHERE key = 'secret_hash'")).toEqual([{ value: input.secretHash }]);
  });

  it.each([
    ['text that is no digest', 'secret'],
    ['a digest in upper case', 'A'.repeat(64)],
    ['a digest that is too short', 'a'.repeat(63)],
    ['a digest that is too long', 'a'.repeat(65)],
    ['nothing', ''],
  ])('refuses %s and creates nothing', async (_name, hash) => {
    const stub = untouchedStub();
    const valid = await validInit();
    for (const input of [{ ...valid, secretHash: hash }, { ...valid, codeHash: hash }, { ...valid, hostKeyHash: hash }]) {
      expect(await failureOf(stub, (table) => table.init(input))).toBe('A table keeps SHA-256 digests only.');
    }
    expect(await tableNames(stub)).toEqual([]);
  });

  it('creates the schema in one transaction: a failure part way leaves none of it', async () => {
    const stub = untouchedStub();
    // A table of the schema's name stands in the way of the second statement.
    await runInDurableObject(stub, (_table, state) => { state.storage.sql.exec('CREATE TABLE players (leftover TEXT)'); });
    const input = await validInit();
    expect(await failureOf(stub, (table) => table.init(input))).toContain('table players already exists');
    expect(await tableNames(stub)).toEqual(['players']);
    expect(await stub.isInitialised()).toBe(false);
  });

  it('still holds its table when the object is evicted and wakes again', async () => {
    const stub = untouchedStub();
    await stub.init(await validInit());
    await evictDurableObject(stub);
    expect(await stub.isInitialised()).toBe(true);
    expect(await tableNames(stub)).toEqual(['events', 'knocks', 'meta', 'players']);
  });
});

describe('isInitialised', () => {
  it('reads sqlite_master and creates nothing', async () => {
    const stub = untouchedStub();
    const seen = await runInDurableObject(stub, (_table, state) => ({
      first: isInitialised(state.storage.sql),
      second: isInitialised(state.storage.sql),
      tables: state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((row) => row.name).filter((name) => !name.startsWith('_cf_')),
    }));
    expect(seen).toEqual({ first: false, second: false, tables: [] });
  });

  it('is true once the schema exists, whoever made it', async () => {
    const stub = untouchedStub();
    expect(await runInDurableObject(stub, (_table, state) => { createSchema(state.storage.sql); return isInitialised(state.storage.sql); })).toBe(true);
  });

  it('is false again when the storage is deleted', async () => {
    const stub = untouchedStub();
    await stub.init(await validInit());
    const answer = await runInDurableObject(stub, async (_table, state) => {
      await state.storage.deleteAll();
      return isInitialised(state.storage.sql);
    });
    expect(answer).toBe(false);
  });
});

describe('meta', () => {
  it('answers null for a key nobody set, the value of a key somebody did, and the newest of two', async () => {
    const stub = untouchedStub();
    const seen = await runInDurableObject(stub, (_table, state) => {
      const sql = state.storage.sql;
      createSchema(sql);
      const unset = getMeta(sql, 'created_at');
      setMeta(sql, 'created_at', '1');
      const first = getMeta(sql, 'created_at');
      setMeta(sql, 'created_at', '2');
      return { unset, first, second: getMeta(sql, 'created_at'), rows: sql.exec('SELECT COUNT(*) AS n FROM meta').one().n };
    });
    expect(seen).toEqual({ unset: null, first: '1', second: '2', rows: 1 });
  });
});

describe('events', () => {
  /** Runs `check` over a schema without the event `init` schedules. */
  function withEvents<T>(check: (sql: SqlStorage) => T): Promise<T> {
    return runInDurableObject(untouchedStub(), (_table, state) => {
      createSchema(state.storage.sql);
      return check(state.storage.sql);
    });
  }

  it('has no earliest moment and nothing due while none is scheduled', async () => {
    expect(await withEvents((sql) => ({ earliest: earliestDue(sql), due: dueEvents(sql, Number.MAX_SAFE_INTEGER) }))).toEqual({ earliest: null, due: [] });
  });

  it('lists what is due at a moment or before it, in the order it runs', async () => {
    const due = await withEvents((sql) => {
      upsertEvent(sql, { kind: 'cleanup', subject: 'c', due: 300 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'b', due: 200 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'a', due: 200 });
      upsertEvent(sql, { kind: 'beat', subject: 'z', due: 200 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'later', due: 301 });
      return dueEvents(sql, 300);
    });
    expect(due).toEqual([
      { kind: 'beat', subject: 'z', due: 200 },
      { kind: 'cleanup', subject: 'a', due: 200 },
      { kind: 'cleanup', subject: 'b', due: 200 },
      { kind: 'cleanup', subject: 'c', due: 300 },
    ]);
  });

  it('knows the earliest moment', async () => {
    const earliest = await withEvents((sql) => {
      upsertEvent(sql, { kind: 'cleanup', subject: 'late', due: 900 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'early', due: 100 });
      return earliestDue(sql);
    });
    expect(earliest).toBe(100);
  });

  it('keeps one event of a kind and a subject: scheduling again moves it', async () => {
    const seen = await withEvents((sql) => {
      upsertEvent(sql, { kind: 'cleanup', subject: 'table', due: 100 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'table', due: 500 });
      return dueEvents(sql, 1000);
    });
    expect(seen).toEqual([{ kind: 'cleanup', subject: 'table', due: 500 }]);
  });

  it('cancels an event whenever it is due, and no other', async () => {
    const seen = await withEvents((sql) => {
      upsertEvent(sql, { kind: 'cleanup', subject: 'table', due: 100 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'other', due: 100 });
      cancelEvent(sql, 'cleanup', 'table');
      return dueEvents(sql, 1000);
    });
    expect(seen).toEqual([{ kind: 'cleanup', subject: 'other', due: 100 }]);
  });

  it('removes an event that ran, but not one scheduled again for another moment meanwhile', async () => {
    const seen = await withEvents((sql) => {
      upsertEvent(sql, { kind: 'cleanup', subject: 'ran', due: 100 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'again', due: 100 });
      upsertEvent(sql, { kind: 'cleanup', subject: 'again', due: 700 });
      removeEvent(sql, { kind: 'cleanup', subject: 'ran', due: 100 });
      removeEvent(sql, { kind: 'cleanup', subject: 'again', due: 100 });
      return dueEvents(sql, 1000);
    });
    expect(seen).toEqual([{ kind: 'cleanup', subject: 'again', due: 700 }]);
  });
});
