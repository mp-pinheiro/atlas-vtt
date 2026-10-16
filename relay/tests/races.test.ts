import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { CLOSE, type RelayFrame } from '../../src/app/online/protocol/relay.ts';
import type { Table } from '../src/Table.ts';
import { attachment } from '../src/connections.ts';
import { sha256 } from '../src/credentials.ts';
import type { TableConfig } from '../src/tableState.ts';
import { createTable, host, join, type Peer } from './peers.ts';

const peers: Peer[] = [];
afterEach(async () => {
  const closing = peers.splice(0);
  for (const peer of closing) peer.close();
  await Promise.all(closing.map((peer) => peer.closed));
  await reset();
});

interface DelayedBody {
  readonly stream: ReadableStream<Uint8Array>;
  finish(): void;
}
function delayedBody(text: string): DelayedBody {
  const bytes = new TextEncoder().encode(text);
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(value) {
    controller = value;
    value.enqueue(bytes.subarray(0, -1));
  } });
  return { stream, finish: () => {
    if (controller === undefined) throw new Error('Body controller unavailable');
    controller.enqueue(bytes.subarray(-1));
    controller.close();
  } };
}

describe('relay lifecycle races', () => {
  it.each(['initialize', 'version', 'malformed'] as const)('does not touch deleted state when a delayed %s body completes', async (kind) => {
    const table = await createTable();
    const codeHash = await sha256(table.code);
    const config: TableConfig = { codeHash, secretHash: await sha256(table.secret), hostFingerprint: await sha256(env.HOST_KEY ?? ''), createdAt: Date.now() };
    const stub = env.TABLES.get(env.TABLES.idFromName(codeHash));
    const result = await runInDurableObject(stub, async (instance: Table, state) => {
      const text = kind === 'initialize' ? JSON.stringify(config) : kind === 'version' ? JSON.stringify({ v: 2, t: 'hello', role: 'player', name: 'Alice' }) : '{broken';
      const body = delayedBody(text);
      const pending = instance.fetch(new Request(`https://table/${kind === 'initialize' ? 'initialize' : 'stream'}`, { method: 'POST', body: body.stream }));
      await instance.end(CLOSE.ended, 'ended');
      body.finish();
      const response = await pending;
      return {
        status: response.status,
        tables: state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_schema WHERE name IN ('meta','players','waiting','gate_failures','active_players')").toArray(),
        keys: (await state.storage.list()).size,
        alarm: await state.storage.getAlarm(),
      };
    });
    expect(result).toEqual({ status: kind === 'initialize' ? 409 : 410, tables: [], keys: 0, alarm: null });
  });

  it('continues a GM broadcast past a player whose socket is already closing', async () => {
    const table = await createTable();
    const gm = await host(table);
    peers.push(gm);
    const rejected = await join(table, 'Closing player');
    const current = await join(table, 'Current player');
    peers.push(rejected, current);
    const welcome = await rejected.next((frame) => frame.t === 'welcome') as Extract<RelayFrame, { t: 'welcome'; role: 'player' }>;
    await current.next((frame) => frame.t === 'welcome');
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    await runInDurableObject(stub, async (instance: Table, state) => {
      const sockets = state.getWebSockets();
      const bad = sockets.find((socket) => attachment(socket)?.id === welcome.id);
      const hostSocket = sockets.find((socket) => attachment(socket)?.role === 'gm');
      if (bad === undefined || hostSocket === undefined) throw new Error('Expected authenticated sockets');
      bad.close(CLOSE.tooLarge, 'too large');
      await instance.webSocketMessage(hostSocket, JSON.stringify({ v: 1, t: 'send', to: '*', body: { deliveredAfterRejection: true } }));
    });
    expect(await rejected.closed).toBe(CLOSE.tooLarge);
    expect(await current.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: { deliveredAfterRejection: true } });
    gm.send({ t: 'send', body: { hostStillUsable: true } });
    expect(await current.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: { hostStillUsable: true } });
  });

  it('abandons an interrupted replacement whose host fingerprint was revoked', async () => {
    const table = await createTable();
    const gm = await host(table);
    peers.push(gm);
    const idName = await sha256('revoked replacement fixture');
    const operation = { idName, secretHash: await sha256('revoked replacement secret'), hostFingerprint: '0'.repeat(64), oldIdName: await sha256(table.code), createdAt: Date.now() };
    const target = env.TABLES.get(env.TABLES.idFromName(idName));
    expect((await target.fetch('https://table/initialize', { method: 'POST', body: JSON.stringify({ ...operation, codeHash: idName }) })).status).toBe(204);
    await evictDurableObject(target);
    const registry = env.HOSTS.get(env.HOSTS.idFromName('host'));
    await runInDurableObject(registry, async (_instance, state) => {
      state.storage.sql.exec('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'pending', JSON.stringify(operation));
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const replacement = await createTable();
    expect(await gm.closed).toBe(CLOSE.superseded);
    const state = await runInDurableObject(registry, (_instance, context) => ({
      pending: context.storage.sql.exec('SELECT value FROM meta WHERE key = ?', 'pending').toArray(),
      active: context.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'active').one().value,
    }));
    expect(state).toEqual({ pending: [], active: await sha256(replacement.code) });
    expect(await runInDurableObject(target, (_instance, context) => context.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_schema WHERE name IN ('meta','players','waiting','gate_failures','active_players')").toArray())).toEqual([]);
  });
});
