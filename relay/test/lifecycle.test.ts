import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { randomBase32, sha256Hex } from '../src/table/codec.ts';
import { cleanup, supersede, teardown } from '../src/table/lifecycle.ts';
import { EVENT_RETRY_MS } from '../src/table/limits.ts';
import type { TableObject } from '../src/table/TableObject.ts';
import { acceptSockets, createTable, sqlRows, tableNames, tableStub } from './helpers.ts';

afterEach(async () => {
  await reset();
});

async function madeStub(): Promise<DurableObjectStub<TableObject>> {
  const stub = env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
  const hash = await sha256Hex('x');
  await stub.init({ secretHash: hash, codeHash: hash, hostKeyHash: hash });
  return stub;
}

describe('teardown', () => {
  it('closes every socket of the object with the code and the reason, deletes the storage and cancels the alarm', async () => {
    const stub = await madeStub();
    const closings = await acceptSockets(stub, 3);
    const alarmBefore = await runInDurableObject(stub, (_table, state) => state.storage.getAlarm());
    expect(alarmBefore).not.toBeNull();
    await runInDurableObject(stub, (_table, state) => teardown(state, CLOSE.ended, 'ended'));
    expect(await Promise.all(closings)).toEqual(Array.from({ length: 3 }, () => ({ code: 4008, reason: 'ended' })));
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });

  it('ends a table that has no sockets', async () => {
    const stub = await madeStub();
    await runInDurableObject(stub, (_table, state) => teardown(state, CLOSE.superseded, 'superseded'));
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
  });

  it('deletes the storage even when a socket cannot be closed with the code', async () => {
    const stub = await madeStub();
    const closings = await acceptSockets(stub, 2);
    expect(closings).toHaveLength(2);
    // 1005 is no code a socket may be closed with: the runtime throws for each socket.
    await runInDurableObject(stub, (_table, state) => teardown(state, 1005, 'refused'));
    expect(await tableNames(stub)).toEqual([]);
  });

  it('leaves no table behind that wakes again: the object stays empty after it is evicted', async () => {
    const stub = await madeStub();
    await runInDurableObject(stub, (_table, state) => teardown(state, CLOSE.ended, 'ended'));
    await evictDurableObject(stub);
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });
});

describe('supersede', () => {
  it('closes every socket with superseded (4016) and deletes the table', async () => {
    const stub = await madeStub();
    const closings = await acceptSockets(stub, 2);
    await stub.supersede();
    expect(await Promise.all(closings)).toEqual([{ code: CLOSE.superseded, reason: 'superseded' }, { code: CLOSE.superseded, reason: 'superseded' }]);
    expect(await tableNames(stub)).toEqual([]);
  });

  it('leaves an object that holds no table as it is: it deletes nothing, and creates nothing', async () => {
    const stub = env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
    await stub.supersede();
    const deletions = await runInDurableObject(stub, async (_table, state) => {
      const deleteAll = vi.spyOn(state.storage, 'deleteAll');
      await supersede(state);
      return deleteAll.mock.calls.length;
    });
    expect(deletions).toBe(0);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });
});

describe('cleanup', () => {
  it('ends the table as the GM\'s end does: every socket closes with ended (4008)', async () => {
    const stub = await madeStub();
    const closings = await acceptSockets(stub, 2);
    await runInDurableObject(stub, (_table, state) => cleanup(state));
    expect(await Promise.all(closings)).toEqual([{ code: CLOSE.ended, reason: 'ended' }, { code: CLOSE.ended, reason: 'ended' }]);
    expect(await tableNames(stub)).toEqual([]);
  });

  it('leaves an object that holds no table as it is: it deletes nothing', async () => {
    const stub = env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
    const deletions = await runInDurableObject(stub, async (_table, state) => {
      const deleteAll = vi.spyOn(state.storage, 'deleteAll');
      await cleanup(state);
      return deleteAll.mock.calls.length;
    });
    expect(deletions).toBe(0);
    expect(await tableNames(stub)).toEqual([]);
  });
});

describe('a table whose GM never connects', () => {
  /** 24 hours, written out in milliseconds on purpose: these tests must not follow a change of `ONE_DAY_MS`. */
  const ONE_DAY_MS = 86_400_000;

  async function tableWithClock(): Promise<{ stub: DurableObjectStub<TableObject>; createdAt: number }> {
    const { code } = await createTable();
    const stub = tableStub(code);
    const rows = await sqlRows(stub, "SELECT value FROM meta WHERE key = 'created_at'");
    return { stub, createdAt: Number(rows[0]?.value) };
  }

  /** Puts the object's clock at `now` (the clock is a public field of the object). */
  function setClock(stub: DurableObjectStub<TableObject>, now: number): Promise<void> {
    return runInDurableObject(stub, (table) => { table.clock = { now: () => now }; });
  }

  it('is set to end 24 hours after it was made: the alarm and the cleanup event stand at that moment', async () => {
    const { stub, createdAt } = await tableWithClock();
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(createdAt + ONE_DAY_MS);
    expect(await sqlRows(stub, 'SELECT kind, subject, due FROM events')).toEqual([{ kind: 'cleanup', subject: 'table', due: createdAt + ONE_DAY_MS }]);
  });

  it('is deleted by the alarm once the 24 hours have passed: its storage is empty', async () => {
    const { stub, createdAt } = await tableWithClock();
    await setClock(stub, createdAt + ONE_DAY_MS + 1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });

  it('is deleted at the very moment the 24 hours are over, and not a moment before', async () => {
    const { stub, createdAt } = await tableWithClock();
    await setClock(stub, createdAt + ONE_DAY_MS - 1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.isInitialised()).toBe(true);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(createdAt + ONE_DAY_MS);
    await setClock(stub, createdAt + ONE_DAY_MS);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.isInitialised()).toBe(false);
  });

  it('is not left without a cleanup when its teardown fails: the cleanup is tried again and the next alarm ends it', async () => {
    const { stub, createdAt } = await tableWithClock();
    const failedAt = createdAt + ONE_DAY_MS;
    await setClock(stub, failedAt);
    await runInDurableObject(stub, (_table, state) => {
      vi.spyOn(state.storage, 'deleteAll').mockRejectedValueOnce(new Error('A transient storage failure.'));
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    // The table is still there, with its cleanup due again shortly and the alarm set for it.
    expect(await stub.isInitialised()).toBe(true);
    expect(await sqlRows(stub, 'SELECT kind, subject, due FROM events')).toEqual([{ kind: 'cleanup', subject: 'table', due: failedAt + EVENT_RETRY_MS }]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(failedAt + EVENT_RETRY_MS);
    await setClock(stub, failedAt + EVENT_RETRY_MS);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });

  it('closes the sockets it has with ended when it goes', async () => {
    const { stub, createdAt } = await tableWithClock();
    const closings = await acceptSockets(stub, 2);
    await setClock(stub, createdAt + ONE_DAY_MS);
    await runDurableObjectAlarm(stub);
    expect(await Promise.all(closings)).toEqual([{ code: 4008, reason: 'ended' }, { code: 4008, reason: 'ended' }]);
  });

  it('is not recreated when the object wakes after it went', async () => {
    const { stub, createdAt } = await tableWithClock();
    await setClock(stub, createdAt + ONE_DAY_MS);
    await runDurableObjectAlarm(stub);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
  });
});

describe('an object nobody made a table in', () => {
  it('holds no table and no alarm: its constructor creates nothing', async () => {
    const stub = env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
    expect(await stub.isInitialised()).toBe(false);
    expect(await tableNames(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBeNull();
  });

  it('answers an alarm that fires without creating anything', async () => {
    const stub = env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
    await runInDurableObject(stub, (_table, state) => state.storage.setAlarm(Date.now() + 3_600_000));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await tableNames(stub)).toEqual([]);
  });
});
