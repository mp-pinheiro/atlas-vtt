import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { CLOSE, type RelayFrame } from '../../src/app/online/protocol/relay.ts';
import { sha256 } from '../src/credentials.ts';
import { attachment } from '../src/connections.ts';
import { createTable, host, join, type Peer } from './peers.ts';

type Waiting = Extract<RelayFrame, { t: 'waiting' }>;
type Knock = Extract<RelayFrame, { t: 'knock' }>;
type Welcome = Extract<RelayFrame, { t: 'welcome'; role: 'player' }>;
const held: Peer[] = [];
function keep(peer: Peer): Peer {
  held.push(peer);
  return peer;
}
afterEach(async () => {
  const closing = held.splice(0);
  for (const peer of closing) peer.close();
  await Promise.all(closing.map((peer) => peer.closed));
  await reset();
});

describe('relay newcomer gates', () => {
  it('keeps a new table closed until the host supplies a gate', async () => {
    const table = await createTable();
    const early = keep(await join(table, 'Early arrival'));
    expect(await early.closed).toBe(CLOSE.wrongCode);
    keep(await host(table));
    const admitted = keep(await join(table, 'After the gate'));
    expect(await admitted.next((frame) => frame.t === 'welcome')).toMatchObject({ role: 'player' });
  });

  it('pauses on the fifth bad code and a gate update clears both failures and pause', async () => {
    const table = await createTable();
    const gm = keep(await host(table));
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = keep(await join(table, `Wrong ${attempt}`, { code: '999999' }));
      expect(await wrong.closed).toBe(attempt === 4 ? CLOSE.paused : CLOSE.wrongCode);
    }
    const paused = await gm.next((frame) => frame.t === 'gate-paused');
    expect(paused).toMatchObject({ t: 'gate-paused', until: expect.any(Number) });
    const correctWhilePaused = keep(await join(table, 'Paused', { code: '483912' }));
    expect(await correctWhilePaused.closed).toBe(CLOSE.paused);
    gm.send({ t: 'gate', code: '111222', ask: false });
    const afterReset = keep(await join(table, 'Reset', { code: '111222' }));
    expect(await afterReset.next((frame) => frame.t === 'welcome')).toMatchObject({ role: 'player' });
  });

  it('keeps eight pending identities, replaces a resumed transport, and preserves its deadline', async () => {
    const table = await createTable();
    const gm = keep(await host(table, true));
    let first: Peer | null = null;
    let token: string | undefined;
    let firstId: string | undefined;
    for (let index = 0; index < 8; index++) {
      const peer = keep(await join(table, `Waiting ${index}`));
      const waiting = await peer.next((frame) => frame.t === 'waiting') as Waiting;
      const knock = await gm.next((frame) => frame.t === 'knock') as Knock;
      if (index === 0) { first = peer; token = waiting.wait; firstId = knock.id; }
    }
    if (token === undefined || first === null || firstId === undefined) throw new Error('Waiting capability was not delivered');
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    const before = await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ deadline: number }>('SELECT deadline FROM waiting WHERE id = ?', firstId).one().deadline);
    const excess = keep(await join(table, 'Ninth'));
    expect(await excess.closed).toBe(CLOSE.tooManyKnocks);
    const resumed = keep(await join(table, 'Changed transport name', { wait: token }));
    await resumed.next((frame) => frame.t === 'waiting');
    expect(await first.closed).toBe(CLOSE.replaced);
    const after = await runInDurableObject(stub, (_instance, state) => ({
      deadline: state.storage.sql.exec<{ deadline: number }>('SELECT deadline FROM waiting WHERE id = ?', firstId).one().deadline,
      count: state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM waiting').one().n,
      connected: state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM active_players').one().n,
    }));
    expect(after).toEqual({ deadline: before, count: 8, connected: 0 });
  });

  it('declines and expires pending requests with their distinct terminal codes', async () => {
    const table = await createTable();
    const gm = keep(await host(table, true));
    const declined = keep(await join(table, 'Declined'));
    await declined.next((frame) => frame.t === 'waiting');
    const decline = await gm.next((frame) => frame.t === 'knock') as Knock;
    gm.send({ t: 'decline', id: decline.id });
    expect(await declined.closed).toBe(CLOSE.declined);
    const expired = keep(await join(table, 'Expired'));
    await expired.next((frame) => frame.t === 'waiting');
    const expire = await gm.next((frame) => frame.t === 'knock') as Knock;
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec('UPDATE waiting SET deadline = ? WHERE id = ?', Date.now() - 1, expire.id);
      for (const socket of state.getWebSockets()) {
        const record = attachment(socket);
        if (record?.id === expire.id) socket.serializeAttachment({ ...record, deadline: Date.now() - 1 });
      }
      await state.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub);
    expect(await expired.closed).toBe(CLOSE.noAnswer);
    expect(await gm.next((frame) => frame.t === 'knock-gone' && frame.id === expire.id)).toEqual({ v: 1, t: 'knock-gone', id: expire.id });
  });

  it('recovers a disconnected admission and lost welcome under one identity until a keyed hello', async () => {
    const table = await createTable();
    const gm = keep(await host(table, true));
    const pending = keep(await join(table, 'Alice'));
    const waiting = await pending.next((frame) => frame.t === 'waiting') as Waiting;
    const knock = await gm.next((frame) => frame.t === 'knock') as Knock;
    if (waiting.wait === undefined) throw new Error('Missing resume capability');
    pending.close();
    await pending.closed;
    gm.send({ t: 'admit', id: knock.id });
    await gm.next((frame) => frame.t === 'knock-gone' && frame.id === knock.id);
    const recovery = keep(await join(table, 'Alice', { wait: waiting.wait }));
    const recovered = await recovery.next((frame) => frame.t === 'welcome') as Welcome;
    expect(recovered.id).toBe(knock.id);
    const secondRecovery = keep(await join(table, 'Alice', { wait: waiting.wait }));
    const final = await secondRecovery.next((frame) => frame.t === 'welcome') as Welcome;
    expect(await recovery.closed).toBe(CLOSE.replaced);
    expect(final.id).toBe(knock.id);
    expect(final.key).not.toBe(recovered.key);
    const keyed = keep(await join(table, 'Alice', { key: final.key }));
    const stable = await keyed.next((frame) => frame.t === 'welcome') as Welcome;
    expect(stable.key).toBe(final.key);
    const consumed = keep(await join(table, 'Alice', { wait: waiting.wait }));
    expect(await consumed.closed).toBe(CLOSE.noAnswer);
  });
});
