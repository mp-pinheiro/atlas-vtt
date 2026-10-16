import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { sha256Hex } from '../src/table/codec.ts';
import { GM_AWAY_MS } from '../src/table/limits.ts';
import { OTHER_HOST_KEY, TEST_HOST_KEY } from './fixtures/hostKey.ts';
import { acceptSockets, authHeaders, createTable, envWithFlakySupersede, fetchWith, tableNames, tableStub } from './helpers.ts';

afterEach(async () => {
  await reset();
});

/** The id strings the host key's registry holds: one row at most. */
async function registryHolds(hostKey: string): Promise<string[]> {
  const registry = env.HOSTS.getByName(await sha256Hex(hostKey));
  const rows = await runInDurableObject(registry, (_registry, state) => state.storage.sql.exec<{ name: string; value: string }>('SELECT name, value FROM registry').toArray());
  return rows.map((row) => `${row.name}=${row.value}`);
}

const idOf = (code: string): string => env.TABLES.idFromName(code).toString();

describe('a new table with the same host key', () => {
  it('ends the first one: its storage is gone, and the registry holds only the second id', async () => {
    const first = await createTable();
    expect(await tableStub(first.code).isInitialised()).toBe(true);
    const second = await createTable();
    expect(await tableStub(first.code).isInitialised()).toBe(false);
    expect(await tableNames(tableStub(first.code))).toEqual([]);
    expect(await tableStub(second.code).isInitialised()).toBe(true);
    expect(await registryHolds(TEST_HOST_KEY)).toEqual([`current=${idOf(second.code)}`]);
  });

  it('closes the first table\'s sockets with superseded (4016)', async () => {
    const first = await createTable();
    const closings = await acceptSockets(tableStub(first.code), 2);
    await createTable();
    expect(await Promise.all(closings)).toEqual([{ code: CLOSE.superseded, reason: 'superseded' }, { code: CLOSE.superseded, reason: 'superseded' }]);
  });

  it('is the only table left of a host key after any number of tables', async () => {
    const codes: string[] = [];
    for (let round = 0; round < 4; round += 1) codes.push((await createTable()).code);
    const live = await Promise.all(codes.map((code) => tableStub(code).isInitialised()));
    expect(live).toEqual([false, false, false, true]);
    expect(await registryHolds(TEST_HOST_KEY)).toEqual([`current=${idOf(codes[3] ?? '')}`]);
  });

  it('is made even when the first table is gone already (it ended or was cleaned up), and creates no storage for the old one', async () => {
    const first = await createTable();
    const stub = tableStub(first.code);
    await runInDurableObject(stub, (table) => { table.clock = { now: () => Date.now() + GM_AWAY_MS + 1 }; });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.isInitialised()).toBe(false);
    const second = await createTable();
    expect(await tableNames(stub)).toEqual([]);
    expect(await tableStub(second.code).isInitialised()).toBe(true);
    expect(await registryHolds(TEST_HOST_KEY)).toEqual([`current=${idOf(second.code)}`]);
  });

  it('keeps the first table\'s digests out of the registry: it holds an object id and a name, nothing of a code, secret or key', async () => {
    const first = await createTable();
    const rows = await registryHolds(TEST_HOST_KEY);
    for (const plain of [first.code, first.secret, TEST_HOST_KEY]) expect(rows.join()).not.toContain(plain);
  });
});

describe('a call that ends the old table fails', () => {
  /** A new table made at a relay whose calls to `supersede` fail as `flaky` says. */
  function createWith(flaky: ReturnType<typeof envWithFlakySupersede>): Promise<Response> {
    return fetchWith(flaky.environment, '/api/tables', { method: 'POST', headers: authHeaders() });
  }

  it('asks again once, and the old table ends', async () => {
    const first = await createTable();
    const flaky = envWithFlakySupersede(1, new Error('A Durable Object call failed.'));
    const response = await createWith(flaky);
    expect(response.status).toBe(201);
    expect(flaky.supersedeCalls()).toBe(2);
    expect(await tableStub(first.code).isInitialised()).toBe(false);
    const second = await response.json<{ code: string }>();
    expect(await tableStub(second.code).isInitialised()).toBe(true);
    expect(await registryHolds(TEST_HOST_KEY)).toEqual([`current=${idOf(second.code)}`]);
  });

  it('asks no more than twice, and still answers with the new table, which stands', async () => {
    await createTable();
    const flaky = envWithFlakySupersede(5, new Error('A Durable Object call failed.'));
    const response = await createWith(flaky);
    expect(response.status).toBe(201);
    expect(flaky.supersedeCalls()).toBe(2);
    const second = await response.json<{ code: string }>();
    expect(await tableStub(second.code).isInitialised()).toBe(true);
    expect(await registryHolds(TEST_HOST_KEY)).toEqual([`current=${idOf(second.code)}`]);
  });

  it('does not ask an overloaded object again', async () => {
    await createTable();
    const flaky = envWithFlakySupersede(5, Object.assign(new Error('Durable Object overloaded.'), { overloaded: true }));
    expect((await createWith(flaky)).status).toBe(201);
    expect(flaky.supersedeCalls()).toBe(1);
  });

  it('asks nobody when the host key had no table before', async () => {
    const flaky = envWithFlakySupersede(5, new Error('A Durable Object call failed.'));
    expect((await createWith(flaky)).status).toBe(201);
    expect(flaky.supersedeCalls()).toBe(0);
  });
});

describe('a table with another host key', () => {
  it('does not end the first one: each host key has its own registry', async () => {
    const first = await createTable(TEST_HOST_KEY);
    const other = await createTable(OTHER_HOST_KEY);
    expect(await tableStub(first.code).isInitialised()).toBe(true);
    expect(await tableStub(other.code).isInitialised()).toBe(true);
    expect(await registryHolds(TEST_HOST_KEY)).toEqual([`current=${idOf(first.code)}`]);
    expect(await registryHolds(OTHER_HOST_KEY)).toEqual([`current=${idOf(other.code)}`]);
  });
});

describe('the registry', () => {
  it('answers null for the first table of a host key and the previous id for every later one', async () => {
    const registry = env.HOSTS.getByName(await sha256Hex('a host'));
    expect(await registry.replace('first')).toBeNull();
    expect(await registry.replace('second')).toBe('first');
    expect(await registry.replace('third')).toBe('second');
  });

  it('keeps one row however many tables it has seen', async () => {
    const registry = env.HOSTS.getByName(await sha256Hex('another host'));
    for (const id of ['a', 'b', 'c']) await registry.replace(id);
    const rows = await runInDurableObject(registry, (_registry, state) => state.storage.sql.exec('SELECT name, value FROM registry').toArray());
    expect(rows).toEqual([{ name: 'current', value: 'c' }]);
  });
});
