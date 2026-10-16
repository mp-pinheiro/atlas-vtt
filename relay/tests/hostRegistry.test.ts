import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { CLOSE, type RelayFrame } from '../../src/app/online/protocol/relay.ts';
import { Table } from '../src/Table.ts';
import { sha256 } from '../src/credentials.ts';
import { createTable, host, join, type Peer } from './peers.ts';

type Welcome = Extract<RelayFrame, { t: 'welcome'; role: 'player' }>;
const peers: Peer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const closing = peers.splice(0);
  for (const peer of closing) peer.close();
  await Promise.all(closing.map((peer) => peer.closed));
  await reset();
});

describe('serialized host table replacement', () => {
  it('leaves the current table usable when replacement initialization is refused', async () => {
    const table = await createTable();
    const gm = await host(table);
    peers.push(gm);
    const player = await join(table, 'Alice');
    peers.push(player);
    const welcome = await player.next((frame) => frame.t === 'welcome') as Welcome;
    const original = Table.prototype.fetch;
    const failing = vi.spyOn(Table.prototype, 'fetch').mockImplementation(async function (this: Table, request: Request): Promise<Response> {
      if (new URL(request.url).pathname === '/initialize') return new Response(null, { status: 503 });
      return original.call(this, request);
    });
    const refused = await SELF.fetch('https://relay.test/api/tables', { method: 'POST', headers: { authorization: `Bearer ${env.HOST_KEY}` } });
    expect(refused.status).toBe(503);
    failing.mockRestore();
    gm.send({ t: 'send', to: welcome.id, body: { oldTableStillAuthoritative: true } });
    expect(await player.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: { oldTableStillAuthoritative: true } });
    const hostStub = env.HOSTS.get(env.HOSTS.idFromName('host'));
    const active = await runInDurableObject(hostStub, (_instance, state) => state.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'active').one().value);
    expect(active).toBe(await sha256(table.code));
  });

  it('replays the persisted transition after interruption without changing its replacement identity', async () => {
    const table = await createTable();
    const gm = await host(table);
    peers.push(gm);
    const original = Table.prototype.fetch;
    let interrupted = false;
    const failing = vi.spyOn(Table.prototype, 'fetch').mockImplementation(async function (this: Table, request: Request): Promise<Response> {
      if (!interrupted && new URL(request.url).pathname === '/end') {
        interrupted = true;
        throw new Error('Simulated interruption before supersession');
      }
      return original.call(this, request);
    });
    let refused = false;
    try {
      const response = await SELF.fetch('https://relay.test/api/tables', { method: 'POST', headers: { authorization: `Bearer ${env.HOST_KEY}` } });
      refused = !response.ok;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    failing.mockRestore();
    const stub = env.HOSTS.get(env.HOSTS.idFromName('host'));
    const before = await runInDurableObject(stub, (_instance, state) => ({
      active: state.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'active').one().value,
      operation: JSON.parse(state.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'pending').one().value) as Record<string, unknown>,
    }));
    expect(before.active).toBe(await sha256(table.code));
    expect(before.operation).toMatchObject({ idName: expect.stringMatching(/^[0-9a-f]{64}$/), secretHash: expect.stringMatching(/^[0-9a-f]{64}$/), hostFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(before.operation).not.toHaveProperty('code');
    expect(before.operation).not.toHaveProperty('secret');
    await evictDurableObject(stub);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await gm.closed).toBe(CLOSE.superseded);
    const after = await runInDurableObject(stub, (_instance, state) => ({
      active: state.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'active').one().value,
      pending: state.storage.sql.exec('SELECT value FROM meta WHERE key = ?', 'pending').toArray(),
    }));
    expect(after).toEqual({ active: before.operation.idName, pending: [] });
  });
});
