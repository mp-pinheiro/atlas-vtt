import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject, SELF } from 'cloudflare:test';
import { CLOSE, type RelayFrame } from '../../src/app/online/protocol/relay.ts';
import { streamSendBody } from '../../src/app/online/protocol/stream.ts';
import { sha256 } from '../src/credentials.ts';
import { connect, createTable, host, join, type Peer } from './peers.ts';
import { openStream, type StreamPeer } from './streamPeer.ts';

type Welcome = Extract<RelayFrame, { t: 'welcome'; role: 'player' }>;
type Knock = Extract<RelayFrame, { t: 'knock' }>;
const peers: Peer[] = [];
const streams: StreamPeer[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) await stream.close();
  const closing = peers.splice(0);
  for (const peer of closing) peer.close();
  await Promise.all(closing.map((peer) => peer.closed));
  await reset();
});

describe('SSE player transport', () => {
  it('starts with a session, shares authenticated routing, and persists neither session secret nor game bodies', async () => {
    const table = await createTable();
    const gm = await host(table);
    peers.push(gm);
    const stream = await openStream(table, { code: '483912' });
    streams.push(stream);
    const welcome = await stream.next((frame) => frame.t === 'welcome') as Welcome;
    expect(stream.first?.kind).toBe('session');
    const posted = await stream.post([{ t: 'send', from: 'forged', body: { privateValue: 'transient body only' } }]);
    expect(posted.status).toBe(204);
    expect(await gm.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', from: welcome.id, body: { privateValue: 'transient body only' } });
    gm.send({ t: 'send', to: welcome.id, body: { recipient: 'SSE only' } });
    expect(await stream.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: { recipient: 'SSE only' } });
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    const persisted = await runInDurableObject(stub, (_instance, state) => JSON.stringify({
      meta: state.storage.sql.exec('SELECT * FROM meta').toArray(),
      players: state.storage.sql.exec('SELECT * FROM players').toArray(),
      waiting: state.storage.sql.exec('SELECT * FROM waiting').toArray(),
    }));
    expect(persisted).not.toContain(stream.sessionSecret());
    expect(persisted).not.toContain(welcome.key);
    expect(persisted).not.toContain('transient body only');
    expect(persisted).not.toContain('SSE player');
  });

  it('can send after a waiting stream is admitted and releases its seat on bye', async () => {
    const table = await createTable();
    const gm = await host(table, true);
    peers.push(gm);
    const stream = await openStream(table, { code: '483912' });
    streams.push(stream);
    await stream.next((frame) => frame.t === 'waiting');
    const knock = await gm.next((frame) => frame.t === 'knock') as Knock;
    gm.send({ t: 'admit', id: knock.id });
    const welcome = await stream.next((frame) => frame.t === 'welcome') as Welcome;
    expect((await stream.post([{ t: 'send', body: { afterAdmission: true } }])).status).toBe(204);
    expect(await gm.next((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', from: welcome.id, body: { afterAdmission: true } });
    const secret = stream.sessionSecret();
    expect((await stream.post([], { bye: true })).status).toBe(204);
    expect(await stream.closed).toBe(CLOSE.ended);
    expect(await gm.next((frame) => frame.t === 'player-left')).toEqual({ v: 1, t: 'player-left', id: welcome.id });
    const stale = await SELF.fetch(`https://relay.test/api/tables/${table.code}/stream/send`, { method: 'POST', body: streamSendBody(secret, []) });
    expect(stale.status).toBe(410);
    const stub = env.TABLES.get(env.TABLES.idFromName(await sha256(table.code)));
    expect(await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM active_players').one().n)).toBe(0);
  });

  it('replaces a stream using the same key and invalidates old send secrets', async () => {
    const table = await createTable();
    peers.push(await host(table));
    const first = await openStream(table, { code: '483912' });
    streams.push(first);
    const welcome = await first.next((frame) => frame.t === 'welcome') as Welcome;
    const oldSecret = first.sessionSecret();
    const second = await openStream(table, { key: welcome.key });
    streams.push(second);
    const rejoined = await second.next((frame) => frame.t === 'welcome') as Welcome;
    expect({ id: rejoined.id, key: rejoined.key }).toEqual({ id: welcome.id, key: welcome.key });
    expect(await first.closed).toBe(CLOSE.replaced);
    const stale = await SELF.fetch(`https://relay.test/api/tables/${table.code}/stream/send`, { method: 'POST', body: streamSendBody(oldSecret, []) });
    expect(stale.status).toBe(410);
  });

  it('rejects old ephemeral secrets after a Durable Object restart without replaying game frames', async () => {
    const table = await createTable();
    peers.push(await host(table));
    const stream = await openStream(table, { code: '483912' });
    streams.push(stream);
    await stream.next((frame) => frame.t === 'welcome');
    const secret = stream.sessionSecret();
    await abortAllDurableObjects();
    const old = await SELF.fetch(`https://relay.test/api/tables/${table.code}/stream/send`, { method: 'POST', body: streamSendBody(secret, [JSON.stringify({ v: 1, t: 'send', body: { mustNotReplay: true } })]) });
    expect(old.status).toBe(410);
  });

  it('announces a real ephemeral session before a gate or version rejection', async () => {
    const table = await createTable();
    peers.push(await host(table));
    const wrong = await openStream(table, { code: '999999' });
    streams.push(wrong);
    expect(await wrong.closed).toBe(CLOSE.wrongCode);
    expect(wrong.first?.kind).toBe('session');
    const version = await openStream(table, { v: 2, code: '483912' });
    streams.push(version);
    expect(await version.closed).toBe(CLOSE.version);
    expect(version.first?.kind).toBe('session');
  });

  it('selects one waiting generation across WebSocket and SSE resumes', async () => {
    const table = await createTable();
    const gm = await host(table, true);
    peers.push(gm);
    const first = await join(table, 'Alice');
    peers.push(first);
    const waiting = await first.next((frame) => frame.t === 'waiting') as Extract<RelayFrame, { t: 'waiting' }>;
    const knock = await gm.next((frame) => frame.t === 'knock') as Knock;
    if (waiting.wait === undefined) throw new Error('Waiting capability is missing');
    const middle = await openStream(table, { wait: waiting.wait });
    streams.push(middle);
    await middle.next((frame) => frame.t === 'waiting');
    expect(await first.closed).toBe(CLOSE.replaced);
    const last = await join(table, 'Alice', { wait: waiting.wait });
    peers.push(last);
    await last.next((frame) => frame.t === 'waiting');
    expect(await middle.closed).toBe(CLOSE.replaced);
    gm.send({ t: 'admit', id: knock.id });
    const welcome = await last.next((frame) => frame.t === 'welcome') as Welcome;
    expect(welcome.id).toBe(knock.id);
    const replacementGm = await connect(table);
    peers.push(replacementGm);
    replacementGm.send({ t: 'hello', role: 'gm', secret: table.secret });
    const roster = await replacementGm.next((frame) => frame.t === 'welcome' && frame.role === 'gm') as Extract<RelayFrame, { t: 'welcome'; role: 'gm' }>;
    expect(roster.players.map((player) => player.id)).toEqual([knock.id]);
    expect(roster.waiting).toBeUndefined();
  });
});
