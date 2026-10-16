import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { PlayerConnection } from '../src/connection/playerConnection.ts';
import { PlayerRouter } from '../src/connection/playerRouter.ts';
import { SocketTransport } from '../src/transports/socketTransport.ts';
import { createPlayerStore, type PlayerIdentity, type PlayerState } from '../src/state/playerStore.ts';
import type { IdentityStorage } from '../src/storage/playerIdentity.ts';
import { CLOSE, type RelayFrame } from '../../src/app/online/protocol/index.ts';
import { TableConnection } from '../../src/app/online/gm/TableConnection.ts';
import { startSmoke } from '../scripts/smoke.mjs';

interface FixtureSnapshot {
  readonly status: string;
  readonly gate: { readonly waiting: readonly { readonly id: string; readonly name: string; readonly armed: boolean }[] };
  readonly ownership: { readonly players: Readonly<Record<string, { readonly name: string }>> };
  readonly state: { readonly objects: { readonly tokens: Readonly<Record<string, { readonly x: number; readonly y: number; readonly resources?: Readonly<Record<string, { readonly current: number; readonly max: number }>> }>> } };
}
interface RunningSmoke {
  readonly relay: { readonly origin: string };
  readonly fixture: { readonly connection: { readonly table: string; readonly code: string }; snapshot(): FixtureSnapshot; command(command: Record<string, unknown>): Promise<unknown> };
  stop(): Promise<void>;
}
interface Peer { readonly connection: PlayerConnection; readonly store: StoreApi<PlayerState>; readonly frames: RelayFrame[]; readonly identity: IdentityStorage; stop(): void }

async function until<T>(read: () => T | undefined | null | false, label: string, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read(); if (value !== undefined && value !== null && value !== false) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function memoryIdentity(): IdentityStorage {
  let value: PlayerIdentity = {};
  return { get: () => value, set: (next) => { value = next; }, clear: () => { value = {}; }, persistent: true };
}

describe.sequential('real companion / browser / local Worker conformance', () => {
  let smoke: RunningSmoke;
  const peers: Peer[] = [];
  const open = (name: string, identity = memoryIdentity(), stream = false): Peer => {
    const store = createPlayerStore();
    const frames: RelayFrame[] = [];
    let connection: PlayerConnection;
    const router = new PlayerRouter({ store, send: (message) => connection.send(message) });
    connection = new PlayerConnection({
      origin: smoke.relay.origin, table: smoke.fixture.connection.table, identity,
      ...(stream ? { socket: (_origin: string, table: string, failure: () => void) => new SocketTransport('http://127.0.0.1:1', table, failure) } : {}),
      onStatus: (status, notice) => store.getState().setStatus(status, notice),
      onTransportGeneration: () => { store.getState().beginTransportGeneration(); router.clear(); },
      onFrame: (frame) => {
        frames.push(frame);
        if (frame.t === 'welcome' && frame.role === 'player') store.getState().setConnection(frame.id, name, frame.gmOnline);
        if (frame.t === 'gm') store.getState().setConnection(store.getState().playerId, name, frame.online);
        router.receive(frame);
      },
    });
    const peer = { connection, store, frames, identity, stop: (): void => { connection.stop(); router.destroy(); } };
    peers.push(peer); connection.start({ name, code: smoke.fixture.connection.code }); return peer;
  };
  const admitted = async (peer: Peer, name: string): Promise<string> => {
    const waiting = await until(() => smoke.fixture.snapshot().gate.waiting.find((person) => person.name === name && person.armed), `armed knock from ${name}`);
    await smoke.fixture.command({ type: 'admit', id: waiting.id });
    return until(() => peer.store.getState().playerId, `${name} welcome`);
  };

  beforeAll(async () => {
    smoke = await startSmoke({ relayPort: 18877, port: 18878 });
    await until(() => smoke.fixture.snapshot().status === 'online', 'GM online');
  }, 90000);
  afterAll(async () => { for (const peer of peers) peer.stop(); await smoke?.stop(); });

  it('authenticates only the local host key and serves the configured twelve-seat access', async () => {
    const anonymous = await fetch(`${smoke.relay.origin}/api/me`);
    expect(anonymous.status).toBe(401);
    const response = await fetch(`${smoke.relay.origin}/api/me`, { headers: { Authorization: 'Bearer atlas-vtt-local-test-host-key' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: { id: 'fairfruit' }, access: { maxPlayers: 12 } });
  });

  it('recovers a waiting identity, admits WS and SSE players, routes real scene, move, dice, chat and book writes', async () => {
    const identity = memoryIdentity();
    const waiting = open('Alice', identity);
    await until(() => identity.get().wait, 'persisted wait capability');
    waiting.stop();
    const alice = open('Alice', identity);
    const aliceId = await admitted(alice, 'Alice');
    expect(smoke.fixture.snapshot().gate.waiting.filter((entry) => entry.name === 'Alice')).toHaveLength(0);
    const bob = open('Bob', memoryIdentity(), true);
    const bobId = await admitted(bob, 'Bob');
    await smoke.fixture.command({ type: 'give', token: 'alice', player: aliceId });
    await smoke.fixture.command({ type: 'give', token: 'bob', player: bobId });
    const own = await until(() => alice.store.getState().scene?.mine?.tokens[0], 'Alice movement alias');
    const scene = alice.store.getState().scene!.scene.id;
    expect(alice.connection.send({ t: 'move', scene, id: own, x: 385, y: 315 })).toBe(true);
    await until(() => smoke.fixture.snapshot().state.objects.tokens.alice?.x === 385, 'authoritative move');
    expect(alice.connection.send({ t: 'roll', scene, formula: '1d20', token: null, mode: 'public' })).toBe(true);
    await until(() => alice.store.getState().log.some((entry) => entry.kind === 'roll'), 'public dice log');
    const bobRolls = bob.store.getState().log.filter((entry) => entry.kind === 'roll').length;
    expect(alice.connection.send({ t: 'roll', scene, formula: '1d6', token: null, mode: 'self' })).toBe(true);
    await until(() => alice.store.getState().log.filter((entry) => entry.kind === 'roll').length >= 2, 'private dice log');
    expect(bob.store.getState().log.filter((entry) => entry.kind === 'roll')).toHaveLength(bobRolls);
    const note = { id: 'a'.repeat(24), title: 'Road notes', body: 'Only Alice owns this page.' };
    expect(alice.connection.send({ t: 'book-note', note })).toBe(true);
    await until(() => alice.store.getState().book?.notes.some((entry) => entry.id === note.id), 'authoritative book note');
    await until(() => alice.store.getState().book?.character?.resources.some((resource) => resource.key === 'hp' && resource.editable), 'editable book resource');
    expect(alice.connection.send({ t: 'book-resource', key: 'hp', current: 5 })).toBe(true);
    await until(() => smoke.fixture.snapshot().state.objects.tokens.alice?.resources?.hp?.current === 5, 'real resource store write');
    expect(smoke.fixture.snapshot().state.objects.tokens.alice?.resources?.hp?.max).toBe(12);
    const pin = await until(() => alice.store.getState().scene?.pins?.[0], 'readable pin alias');
    expect(alice.connection.send({ t: 'pin-found', scene, pin: pin.id })).toBe(true);
    await until(() => alice.store.getState().log.some((entry) => entry.kind === 'found'), 'FoundShare note dispatch');
    expect(await smoke.fixture.command({ type: 'show-image' })).toBe('shown');
    await until(() => alice.store.getState().shownImage?.shown, 'ImageShare dispatch');
    await smoke.fixture.command({ type: 'dismiss-image' });
    expect(alice.connection.send({ t: 'chat', text: 'Hello Bob', to: [bobId] })).toBe(true);
    await until(() => bob.store.getState().log.some((entry) => entry.kind === 'chat' && JSON.stringify(entry).includes('Hello Bob')), 'whisper routed through OnlineTable');
    expect(aliceId).not.toBe(bobId);
  }, 60000);

  it('keeps keyed identities stable across GM absence/restart and never replays an offline edit', async () => {
    const alice = peers.find((peer) => peer.store.getState().playerName === 'Alice' && peer.store.getState().playerId !== null)!;
    const saved = alice.identity.get();
    const before = smoke.fixture.snapshot().state.objects.tokens.alice!.x;
    await smoke.fixture.command({ type: 'disconnect' });
    await until(() => alice.store.getState().gmOnline === false, 'GM offline frame');
    const scene = alice.store.getState().scene!.scene.id;
    const alias = alice.store.getState().scene!.mine!.tokens[0]!;
    expect(alice.connection.send({ t: 'move', scene, id: alias, x: 595, y: 315 })).toBe(false);
    alice.stop();
    const returning = open('Alice', alice.identity);
    await until(() => returning.store.getState().playerId, 'keyed join while GM absent');
    expect(returning.identity.get()).toEqual(saved);
    expect(returning.store.getState().gmOnline).toBe(false);
    await smoke.fixture.command({ type: 'restart' });
    await until(() => returning.store.getState().gmOnline && returning.store.getState().scene?.tokens, 'readiness-triggered fresh scene');
    const sse = peers.find((peer) => peer.store.getState().playerName === 'Bob');
    await until(() => sse?.store.getState().gmOnline && sse.store.getState().scene?.tokens, 'SSE readiness after GM restart');
    expect(smoke.fixture.snapshot().state.objects.tokens.alice!.x).toBe(before);
    expect(returning.identity.get().key).toBe(saved.key);
  }, 60000);

  it('supersedes the old table only after creating its replacement and ends the replacement', async () => {
    const response = await fetch(`${smoke.relay.origin}/api/tables`, { method: 'POST', headers: { Authorization: 'Bearer atlas-vtt-local-test-host-key' } });
    expect(response.status).toBe(201);
    const replacement = await response.json() as { code: string; secret: string };
    await until(() => peers.some((peer) => peer.store.getState().status === 'blocked'), 'superseded player close');
    let online = false;
    const gm = new TableConnection(smoke.relay.origin, replacement.code, replacement.secret, { status: (value) => { online = value === 'online'; }, welcome: () => { online = true; }, joined: () => { throw new Error('Replacement has no player'); }, left: () => { throw new Error('Replacement has no player'); }, message: () => { throw new Error('Replacement has no game traffic'); } });
    try {
      gm.start(); await until(() => online, 'replacement host welcome'); gm.end();
      const close = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`${smoke.relay.origin.replace(/^http/, 'ws')}/api/tables/${replacement.code}/socket`);
        socket.addEventListener('open', () => socket.send(JSON.stringify({ v: 1, t: 'hello', role: 'player', name: 'Late arrival', code: '483912', waits: true })), { once: true });
        socket.addEventListener('close', (event) => resolve(event.code), { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      expect(close).toBe(CLOSE.ended);
    } finally { gm.stop(); }
  }, 30000);
});
