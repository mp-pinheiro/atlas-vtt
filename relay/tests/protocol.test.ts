import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { CLOSE, MAX_PLAYER_FRAME, parseRelayFrame, type RelayFrame } from '../../src/app/online/protocol/relay.ts';
import { sha256 } from '../src/credentials.ts';
import { attachment } from '../src/connections.ts';
import { SOCKET_RATE } from '../src/limits.ts';
import { connect, createTable, host, join, type Peer, type TestTable } from './peers.ts';

type Welcome = Extract<RelayFrame, { t: 'welcome'; role: 'player' }>;
const held: Peer[] = [];
function keep(peer: Peer): Peer {
  held.push(peer);
  return peer;
}
async function stubOf(table: TestTable): Promise<DurableObjectStub> {
  return env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
}
afterEach(async () => {
  const closing = held.splice(0);
  for (const peer of closing) peer.close();
  await Promise.all(closing.map((peer) => peer.closed));
  await reset();
});

describe('relay authenticated transport boundaries', () => {
  it('keeps returning keys stable, replaces only the old generation, and stamps the authenticated sender', async () => {
    const table = await createTable();
    const gm = keep(await host(table));
    const first = keep(await join(table, 'Alice'));
    const welcome = await first.next((frame) => frame.t === 'welcome') as Welcome;
    const second = keep(await join(table, 'Alice again', { key: welcome.key }));
    const returned = await second.next((frame) => frame.t === 'welcome') as Welcome;
    expect(await first.closed).toBe(CLOSE.replaced);
    expect({ id: returned.id, key: returned.key }).toEqual({ id: welcome.id, key: welcome.key });
    second.send({ t: 'send', from: 'forged-player', body: { value: 'current generation' } });
    const delivered = await gm.next((frame) => frame.t === 'game');
    expect(delivered).toEqual({ v: 1, t: 'game', from: welcome.id, body: { value: 'current generation' } });
    gm.send({ t: 'send', to: welcome.id, body: { reply: 'still connected' } });
    expect(await second.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: { reply: 'still connected' } });
  });

  it('admits twelve connected identities, refuses the thirteenth, and frees a seat on disconnect', async () => {
    const table = await createTable();
    keep(await host(table));
    const players: Peer[] = [];
    for (let index = 0; index < 12; index++) {
      const peer = keep(await join(table, `Player ${index}`));
      await peer.next((frame) => frame.t === 'welcome');
      players.push(peer);
    }
    const excess = keep(await join(table, 'Thirteenth'));
    expect(await excess.closed).toBe(CLOSE.full);
    players[0]!.close();
    await players[0]!.closed;
    const replacement = keep(await join(table, 'New seat'));
    expect(await replacement.next((frame) => frame.t === 'welcome')).toMatchObject({ role: 'player' });
  });

  it('rejects invalid secrets without creating a second identity or knock', async () => {
    const table = await createTable();
    keep(await host(table, true));
    const gm = keep(await connect(table));
    gm.send({ t: 'hello', role: 'gm', secret: 'x'.repeat(43) });
    expect(await gm.closed).toBe(CLOSE.badSecret);
    const player = keep(await join(table, 'Forged key', { key: 'x'.repeat(43) }));
    expect(await player.closed).toBe(CLOSE.badSecret);
    const state = await runInDurableObject(await stubOf(table), (_instance, ctx) => ({
      players: ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM players').one().n,
      waits: ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM waiting').one().n,
    }));
    expect(state).toEqual({ players: 0, waits: 0 });
  });

  it.each([
    { frame: { t: 'hello', role: 'player', name: 'Again', code: '483912' }, code: CLOSE.protocol },
    { frame: { t: 'send', to: '*', body: { forbidden: true } }, code: CLOSE.protocol },
    { frame: { t: 'kick', id: 'a'.repeat(20) }, code: CLOSE.protocol },
    { frame: { v: 2, t: 'send', body: {} }, code: CLOSE.version },
  ])('rejects a forbidden authenticated frame $frame.t with $code', async ({ frame, code }) => {
    const table = await createTable();
    keep(await host(table));
    const player = keep(await join(table, 'Alice'));
    await player.next((value) => value.t === 'welcome');
    player.send(frame);
    expect(await player.closed).toBe(code);
  });

  it('bounds UTF-8 before parsing and refuses binary or pre-authentication game traffic', async () => {
    const table = await createTable();
    const large = keep(await connect(table));
    large.socket.send('x'.repeat(MAX_PLAYER_FRAME + 1));
    expect(await large.closed).toBe(CLOSE.tooLarge);
    const binary = keep(await connect(table));
    binary.socket.send(new Uint8Array([1, 2, 3]).buffer);
    expect(await binary.closed).toBe(CLOSE.protocol);
    const early = keep(await connect(table));
    early.send({ t: 'send', body: {} });
    expect(await early.closed).toBe(CLOSE.protocol);
    const version = keep(await connect(table));
    version.send({ v: 2, t: 'hello', role: 'player', name: 'Alice' });
    expect(await version.closed).toBe(CLOSE.version);
  });

  it('persists rate exhaustion through hibernation instead of refilling an attachment', async () => {
    const table = await createTable();
    keep(await host(table));
    const player = keep(await join(table, 'Alice'));
    await player.next((value) => value.t === 'welcome');
    const stub = await stubOf(table);
    await runInDurableObject(stub, (_instance, ctx) => {
      for (const socket of ctx.getWebSockets()) {
        const state = attachment(socket);
        if (state?.role === 'player') socket.serializeAttachment({ ...state, tokens: 0, updatedAt: Date.now() + 60_000 });
      }
    });
    await evictDurableObject(stub, { webSockets: 'hibernate' });
    player.send({ t: 'send', body: { rejected: true } });
    expect(await player.closed).toBe(CLOSE.rateLimited);
  });

  it('uses the GM socket bucket instead of the player rate allowance', async () => {
    const table = await createTable();
    const gm = keep(await connect(table));
    gm.send({ t: 'hello', role: 'gm', secret: table.secret });
    await gm.next((frame) => frame.t === 'welcome' && frame.role === 'gm');
    const stub = await stubOf(table);
    const available = await runInDurableObject(stub, (_instance, ctx) => {
      const socket = ctx.getWebSockets().find((candidate) => attachment(candidate)?.role === 'gm');
      const state = socket === undefined ? null : attachment(socket);
      if (socket === undefined || state === null) throw new Error('Authenticated GM socket was not attached');
      socket.serializeAttachment({ ...state, tokens: 1, updatedAt: Date.now() + 60_000 });
      return state.tokens;
    });
    expect(available).toBe(SOCKET_RATE.gmBurst);
    gm.send({ t: 'gate', code: '483912', ask: false });
    gm.send({ t: 'gate', code: '483912', ask: false });
    expect(await gm.closed).toBe(CLOSE.rateLimited);
  });

  it('limits pending sockets and expires an unauthenticated handshake', async () => {
    const table = await createTable();
    for (let index = 0; index < 32; index++) keep(await connect(table));
    const excess = keep(await connect(table));
    expect(await excess.closed).toBe(CLOSE.rateLimited);
  });

  it('kicks revoke the key and remove connected membership before stale close events', async () => {
    const table = await createTable();
    const gm = keep(await host(table));
    const player = keep(await join(table, 'Alice'));
    const welcome = await player.next((frame) => frame.t === 'welcome') as Welcome;
    await gm.next((frame) => frame.t === 'player-joined');
    gm.send({ t: 'kick', id: welcome.id });
    expect(await player.closed).toBe(CLOSE.kicked);
    expect(await gm.next((frame) => frame.t === 'player-left')).toEqual({ v: 1, t: 'player-left', id: welcome.id });
    const back = keep(await join(table, 'Alice', { key: welcome.key }));
    expect(await back.closed).toBe(CLOSE.badSecret);
  });

  it('ends all transports when the configured host fingerprint changes', async () => {
    const table = await createTable();
    const gm = keep(await host(table));
    const player = keep(await join(table, 'Alice'));
    await player.next((frame) => frame.t === 'welcome');
    await runInDurableObject(await stubOf(table), (_instance, ctx) => { ctx.storage.sql.exec('UPDATE meta SET value = ? WHERE key = ?', '0'.repeat(64), 'hostFingerprint'); });
    const replacement = keep(await connect(table));
    replacement.send({ t: 'hello', role: 'gm', secret: table.secret });
    expect(await replacement.closed).toBe(CLOSE.noAccess);
    expect(await gm.closed).toBe(CLOSE.noAccess);
    expect(await player.closed).toBe(CLOSE.noAccess);
  });

  it('supersedes the previous active table only after creating its replacement', async () => {
    const first = await createTable();
    const gm = keep(await host(first));
    const player = keep(await join(first, 'Alice'));
    await player.next((frame) => frame.t === 'welcome');
    const second = await createTable();
    expect(await gm.closed).toBe(CLOSE.superseded);
    expect(await player.closed).toBe(CLOSE.superseded);
    const active = keep(await host(second));
    const usable = keep(await join(second, 'Bob'));
    const welcome = await usable.next((frame) => frame.t === 'welcome') as Welcome;
    active.send({ t: 'send', to: welcome.id, body: { table: 'replacement' } });
    expect(await usable.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: { table: 'replacement' } });
    const ended = keep(await connect(first));
    expect(await ended.closed).toBe(CLOSE.ended);
  });

  it('dispatches valid GM batches in order and rejects an invalid batch without partial delivery', async () => {
    const table = await createTable();
    const gm = keep(await host(table));
    const player = keep(await join(table, 'Alice'));
    const welcome = await player.next((frame) => frame.t === 'welcome') as Welcome;
    gm.send({ t: 'sends', sends: [1, 2, 3].map((order) => ({ to: welcome.id, body: { order } })) });
    const ordered: RelayFrame[] = [];
    for (let index = 0; index < 3; index++) ordered.push(await player.next((frame) => frame.t === 'game'));
    expect(ordered).toEqual([1, 2, 3].map((order) => ({ v: 1, t: 'game', body: { order } })));
    const received: unknown[] = [];
    player.socket.addEventListener('message', (event) => {
      const frame = typeof event.data === 'string' ? parseRelayFrame(event.data) : null;
      if (frame?.t === 'game') received.push(frame.body);
    });
    gm.send({ t: 'sends', sends: [{ to: welcome.id, body: { mustNotArrive: true } }, { to: welcome.id }] });
    expect(await gm.closed).toBe(CLOSE.protocol);
    await player.next((frame) => frame.t === 'gm' && !frame.online);
    expect(received).toEqual([]);
  });
});
