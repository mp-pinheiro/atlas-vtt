import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { Table } from '../src/Table.ts';
import { attachment } from '../src/connections.ts';
import { sha256 } from '../src/credentials.ts';
import { connect, createTable, type Peer } from './peers.ts';

const held: Peer[] = [];
afterEach(async () => {
  const closing = held.splice(0);
  for (const peer of closing) peer.close();
  await Promise.all(closing.map((peer) => peer.closed));
  await reset();
});

describe('table expiration and deletion', () => {
  it('expires an absent-GM table, closes its sockets, and never recreates storage on late events or eviction', async () => {
    const table = await createTable();
    const peer = await connect(table);
    held.push(peer);
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec('UPDATE meta SET value = ? WHERE key = ?', '1', 'gmAwayAt');
      await state.storage.setAlarm(Date.now() + 1000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await peer.closed).toBe(CLOSE.ended);
    await runInDurableObject(stub, async (instance: Table) => {
      await instance.alarm();
      await instance.end(CLOSE.ended, 'late end');
    });
    await evictDurableObject(stub);
    const reopened = await connect(table);
    held.push(reopened);
    expect(await reopened.closed).toBe(CLOSE.ended);
    const state = await runInDurableObject(stub, async (_instance, durableState) => ({
      keys: (await durableState.storage.list()).size,
      alarm: await durableState.storage.getAlarm(),
      tables: durableState.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_schema WHERE name IN ('meta','players','waiting','gate_failures','active_players')").toArray(),
    }));
    expect(state).toEqual({ keys: 0, alarm: null, tables: [] });
  });

  it('returns the ended close code for an unknown table without writing table state', async () => {
    const table = { code: 'z'.repeat(26), secret: 'x'.repeat(43), maxPlayers: 12 };
    const peer = await connect(table);
    held.push(peer);
    expect(await peer.closed).toBe(CLOSE.ended);
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    const state = await runInDurableObject(stub, async (_instance, ctx) => ({
      keys: (await ctx.storage.list()).size,
      alarm: await ctx.storage.getAlarm(),
      tables: ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_schema WHERE name IN ('meta','players','waiting','active_players')").toArray(),
    }));
    expect(state).toEqual({ keys: 0, alarm: null, tables: [] });
  });

  it('expires a socket that never authenticates at its original handshake deadline', async () => {
    const table = await createTable();
    const peer = await connect(table);
    held.push(peer);
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    await runInDurableObject(stub, async (_instance, ctx) => {
      for (const socket of ctx.getWebSockets()) {
        const state = attachment(socket);
        if (state?.role === 'pending') socket.serializeAttachment({ ...state, deadline: Date.now() - 1 });
      }
      await ctx.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub);
    expect(await peer.closed).toBe(CLOSE.protocol);
  });
});
