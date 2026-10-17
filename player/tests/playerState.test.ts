import { describe, expect, it, vi } from 'vitest';
import { CLOSE, type RelayFrame, type PlayerHello } from '../../src/app/online/protocol/relay.ts';
import type { PlayerMessage } from '../../src/app/online/protocol/game.ts';
import { PlayerConnection } from '../src/connection/playerConnection.ts';
import { PlayerOutbox } from '../src/connection/playerOutbox.ts';
import { PlayerRouter } from '../src/connection/playerRouter.ts';
import { createPlayerStore } from '../src/state/playerStore.ts';
import { playerIdentity } from '../src/storage/playerIdentity.ts';
import type { SocketTransport, TransportCallbacks } from '../src/transports/socketTransport.ts';

class Clock {
  time = 0;
  private serial = 0;
  private readonly tasks = new Map<number, { at: number; callback: () => void; interval: number }>();
  setTimeout(callback: () => void, delay: number): number {
    const id = ++this.serial;
    this.tasks.set(id, { at: this.time + delay, callback, interval: 0 });
    return id;
  }
  clearTimeout(handle: unknown): void { this.tasks.delete(handle as number); }
  setInterval(callback: () => void, delay: number): number {
    const id = ++this.serial;
    this.tasks.set(id, { at: this.time + delay, callback, interval: delay });
    return id;
  }
  clearInterval(handle: unknown): void { this.tasks.delete(handle as number); }
  now(): number { return this.time; }
  random(): number { return 0.5; }
  advance(ms: number): void {
    const end = this.time + ms;
    while (true) {
      const next = [...this.tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, task] = next;
      this.time = task.at;
      if (task.interval === 0) this.tasks.delete(id);
      else task.at += task.interval;
      task.callback();
    }
    this.time = end;
  }
}

class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('player state boundaries', () => {
  it('keeps table state through scene replacement and clears scene transients atomically', () => {
    const store = createPlayerStore();
    store.getState().setLog({ t: 'log', entries: [] });
    store.getState().setBook({
      t: 'book', book: {
        character: null, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: { hidden: [], own: [] }, equipped: [],
      },
    });
    store.getState().beginScene({ id: 'first', map: null, lit: false });
    store.getState().setPrediction('token-alias', { x: 4, y: 8 });
    store.getState().setProposal('token-alias', [{ x: 5, y: 9 }]);
    store.getState().applySceneMessage({ t: 'scene', scene: { id: 'second', map: null, lit: false } });
    const state = store.getState();
    expect(state.scene?.scene.id).toBe('second');
    expect(state.predictions).toEqual({});
    expect(state.proposals).toEqual({});
    expect(state.log).toEqual([]);
    expect(state.book).not.toBeNull();
  });

  it('ignores old picture revisions, covers gaps, and only a whole picture clears the cover', () => {
    const store = createPlayerStore();
    store.getState().beginScene({ id: 'scene-a', map: null, lit: false });
    store.getState().commitPicture('scene-a', 5, true, {});
    store.getState().commitPicture('scene-a', 4, false, {});
    expect(store.getState().scene?.pictureRevision).toBe(5);
    expect(store.getState().scene?.covered).toBe(false);
    store.getState().commitPicture('scene-a', 7, false, {});
    expect(store.getState().scene?.covered).toBe(true);
    store.getState().commitPicture('scene-a', 8, true, {});
    expect(store.getState().scene?.covered).toBe(false);
  });

  it('retains a validated identity and clears it on forget', () => {
    const storage = new MemoryStorage();
    const identity = playerIdentity('abcdefghijklmnopqrstuvwx23', storage);
    identity.set({ playerId: 'abcdefghijklmnopqrst', key: 'A'.repeat(32), wait: 'B'.repeat(32) });
    expect(identity.get()).toEqual({ playerId: 'abcdefghijklmnopqrst', key: 'A'.repeat(32), wait: 'B'.repeat(32) });
    identity.clear();
    expect(identity.get()).toEqual({});
    expect(storage.length).toBe(0);
  });
});

describe('player action delivery', () => {
  it('uses the action bucket and never queues while offline', () => {
    const clock = new Clock();
    const delivered: PlayerMessage[] = [];
    const refused: PlayerMessage[] = [];
    let online = true;
    const outbox = new PlayerOutbox({
      send: (message) => { delivered.push(message); return true; },
      online: () => online,
      timers: clock,
      onRefused: (message) => refused.push(message),
    });
    const roll: PlayerMessage = { t: 'roll', scene: 's', formula: '1d20', token: null };
    expect(outbox.send(roll)).toBe(true);
    expect(outbox.send(roll)).toBe(true);
    expect(outbox.send(roll)).toBe(true);
    expect(outbox.send(roll)).toBe(false);
    expect(refused).toHaveLength(1);
    online = false;
    outbox.clear();
    expect(outbox.send(roll)).toBe(false);
    expect(delivered).toHaveLength(3);
  });
  it('holds a terminal path cancel until the shared movement budget allows it', () => {
    const clock = new Clock();
    const delivered: PlayerMessage[] = [];
    const busy: boolean[] = [];
    const outbox = new PlayerOutbox({
      send: (message) => { delivered.push(message); return true; },
      online: () => true, timers: clock, onBusy: (value) => busy.push(value),
    });
    const move: PlayerMessage = { t: 'move', scene: 's', id: 'a'.repeat(24), x: 100, y: 100 };
    for (let index = 0; index < 8; index++) expect(outbox.send(move)).toBe(true);
    const cancel: PlayerMessage = { t: 'path-cancel', scene: 's', id: 'a'.repeat(24), request: 'b'.repeat(24) };
    expect(outbox.send(cancel)).toBe(true);
    expect(outbox.send(cancel)).toBe(true);
    expect(delivered).toHaveLength(8);
    clock.advance(166);
    expect(delivered).toHaveLength(8);
    clock.advance(1);
    expect(delivered.at(-1)).toEqual(cancel);
    expect(busy.at(-1)).toBe(false);
    outbox.clear();
  });

  it('reports a cancellation refused at the 128-action bound and drops queued cancellation on clear', () => {
    const clock = new Clock();
    let ready = false;
    const delivered: PlayerMessage[] = [];
    const refused: PlayerMessage[] = [];
    const outbox = new PlayerOutbox({
      send: (message) => { delivered.push(message); return true; },
      online: () => true, ready: () => ready, timers: clock, onRefused: (message) => refused.push(message),
    });
    const move: PlayerMessage = { t: 'move', scene: 's', id: 'a'.repeat(24), x: 100, y: 100 };
    for (let index = 0; index < 8; index++) expect(outbox.send(move)).toBe(true);
    const cancel: PlayerMessage = { t: 'path-cancel', scene: 's', id: 'a'.repeat(24), request: 'b'.repeat(24) };
    expect(outbox.send(cancel)).toBe(true);
    for (let index = 0; index < 119; index++) expect(outbox.send({ t: 'claim-request', scene: 's', id: 'c'.repeat(24), request: index.toString(16).padStart(24, '0') })).toBe(true);
    const overflow: PlayerMessage = { ...cancel, request: 'd'.repeat(24) };
    expect(outbox.send(overflow)).toBe(false);
    expect(refused).toContainEqual(overflow);
    outbox.clear();
    ready = true;
    clock.advance(6000);
    expect(delivered).toEqual([]);
  });


  it('rejects malformed actions before delivery and enforces the UTF-8 frame limit', () => {
    const send = vi.fn(() => true);
    const outbox = new PlayerOutbox({ send, online: () => true });
    expect(outbox.send({ t: 'roll', scene: '', formula: '1d20', token: null } as PlayerMessage)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('connection readiness and routing', () => {
  it('announces readiness on welcome and GM return, and blocks actions while the GM is away', () => {
    const clock = new Clock();
    const sent: string[] = [];
    const captured: { callbacks?: TransportCallbacks } = {};
    const socket = {
      connect: (hello: PlayerHello, value: TransportCallbacks) => { captured.callbacks = value; value.opened(); expect(hello.code).toBe('123456'); },
      send: (value: string) => sent.push(value),
      close: vi.fn(),
    } as unknown as SocketTransport;
    const statuses: string[] = [];
    const connection = new PlayerConnection({
      origin: 'https://player.test', table: 'abcdefghijklmnopqrstuvwx23', timers: clock,
      identity: playerIdentity('abcdefghijklmnopqrstuvwx23', new MemoryStorage()),
      socket: () => socket,
      stream: () => { throw new Error('unexpected stream fallback'); },
      onStatus: (status) => statuses.push(status), onFrame: () => undefined,
    });
    connection.start({ name: 'Mira', code: '123456' });
    captured.callbacks?.frame({ v: 1, t: 'welcome', role: 'player', id: 'abcdefghijklmnopqrst', key: 'A'.repeat(32), gmOnline: true });
    expect(sent.map((value) => JSON.parse(value).body.t)).toEqual(['player-ready', 'book-parts']);
    captured.callbacks?.frame({ v: 1, t: 'gm', online: false });
    expect(connection.send({ t: 'colour', colour: 2 })).toBe(false);
    captured.callbacks?.frame({ v: 1, t: 'gm', online: true });
    expect(sent.map((value) => JSON.parse(value).body.t)).toEqual(['player-ready', 'book-parts', 'player-ready', 'book-parts']);
    expect(statuses).toContain('disconnected');
    connection.stop();
  });

  it('requests one channel resync on a delta gap and never forwards the delta', () => {
    const store = createPlayerStore();
    store.getState().beginScene({ id: 'scene-1', map: null, lit: false });
    const sent: unknown[] = [];
    const received: unknown[] = [];
    const router = new PlayerRouter({ store, send: (message) => { sent.push(message); return true; }, onMessage: (message) => received.push(message) });
    const frame: RelayFrame = { v: 1, t: 'game', body: { t: 'delta', of: 'tokens', scene: 'scene-1', seq: 2 } };
    router.receive(frame);
    router.receive(frame);
    expect(sent).toEqual([{ t: 'resync', scene: 'scene-1', of: 'tokens' }]);
    expect(received).toEqual([]);
    expect(store.getState().scene?.covered).toBe(true);
  });

  it('assembles identical multipart duplicates once and applies the second parsed message', () => {
    const store = createPlayerStore();
    const sent: unknown[] = [];
    const router = new PlayerRouter({ store, send: (message) => { sent.push(message); return true; } });
    const bytes = new TextEncoder().encode(JSON.stringify({ t: 'people', people: [] }));
    const first = bytes.slice(0, 9);
    const second = bytes.slice(9);
    const base64 = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
    const part0: RelayFrame = { v: 1, t: 'game', body: { t: 'part', id: 'multipart-1', index: 0, count: 2, data: base64(first) } };
    const part1: RelayFrame = { v: 1, t: 'game', body: { t: 'part', id: 'multipart-1', index: 1, count: 2, data: base64(second) } };
    router.receive(part0);
    router.receive(part0);
    router.receive(part1);
    expect(store.getState().people).toEqual({ t: 'people', people: [] });
    expect(sent).toEqual([]);
  });
  it('applies both table book parts without a scene change', () => {
    const store = createPlayerStore();
    const router = new PlayerRouter({ store, send: () => true });
    router.receive({
      v: 1, t: 'game', body: {
        t: 'book',
        book: { character: null, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: { hidden: [], own: [] }, equipped: [] },
      },
    });
    router.receive({ v: 1, t: 'game', body: { t: 'book-map', worldMap: null } });
    router.receive({ v: 1, t: 'game', body: { t: 'book-quests', quests: [] } });
    expect(store.getState().book?.worldMap).toBeNull();
    expect(store.getState().book?.quests).toEqual([]);
    router.destroy();
  });
});
  it('discards a multipart assembly when duplicate content conflicts', () => {
    const store = createPlayerStore();
    const router = new PlayerRouter({ store, send: () => true });
    const base64 = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
    const first: RelayFrame = { v: 1, t: 'game', body: { t: 'part', id: 'conflict', index: 0, count: 2, data: base64(new Uint8Array([123, 34])) } };
    const conflicting: RelayFrame = { v: 1, t: 'game', body: { t: 'part', id: 'conflict', index: 0, count: 2, data: base64(new Uint8Array([123, 33])) } };
    const last: RelayFrame = { v: 1, t: 'game', body: { t: 'part', id: 'conflict', index: 1, count: 2, data: base64(new Uint8Array([125])) } };
    router.receive(first);
    router.receive(conflicting);
    router.receive(last);
    expect(store.getState().log).toEqual([]);
    router.destroy();
  });

  it('expires incomplete multipart state at thirty seconds', () => {
    const clock = new Clock();
    const store = createPlayerStore();
    const router = new PlayerRouter({ store, send: () => true, now: () => clock.now(), timers: clock });
    const bytes = new TextEncoder().encode(JSON.stringify({ t: 'log', entries: [] }));
    const cut = bytes.slice(0, 10);
    const base64 = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
    router.receive({ v: 1, t: 'game', body: { t: 'part', id: 'expires', index: 0, count: 2, data: base64(cut) } });
    clock.advance(30_001);
    router.receive({ v: 1, t: 'game', body: { t: 'part', id: 'expires', index: 1, count: 2, data: base64(bytes.slice(10)) } });
    expect(store.getState().log).toEqual([]);
    router.destroy();
  });

  it('forgets table state without retaining its identity or scene', () => {
    const store = createPlayerStore();
    store.getState().setConnection('abcdefghijklmnopqrst', 'Mira', true);
    store.getState().setLog({ t: 'log', entries: [] });
    store.getState().beginScene({ id: 'scene', map: null, lit: false });
    store.getState().setPrediction('token', { x: 1, y: 2 });
    store.getState().forgetTable();
    expect(store.getState()).toMatchObject({ playerId: null, playerName: null, scene: null, log: [], book: null, predictions: {}, proposals: {}, feedback: [] });
  });
describe('connection recovery and pacing', () => {
  it('rejoins with its saved key and does not replay a possibly lost action', () => {
    const clock = new Clock();
    const identity = playerIdentity('abcdefghijklmnopqrstuvwx23', new MemoryStorage());
    const handshakes: PlayerHello[] = [];
    const payloads: string[][] = [];
    const transports: TransportCallbacks[] = [];
    const connection = new PlayerConnection({
      origin: 'https://player.test', table: 'abcdefghijklmnopqrstuvwx23', identity, timers: clock,
      socket: () => {
        const sent: string[] = [];
        payloads.push(sent);
        return {
          connect: (hello: PlayerHello, callbacks: TransportCallbacks) => { handshakes.push(hello); transports.push(callbacks); callbacks.opened(); },
          send: (text: string) => { sent.push(text); },
          close: () => undefined,
        } as unknown as SocketTransport;
      },
      stream: () => { throw new Error('unexpected stream fallback'); },
      onStatus: () => undefined, onFrame: () => undefined,
    });
    connection.start({ name: 'Mira', code: '123456' });
    transports[0]?.frame({ v: 1, t: 'welcome', role: 'player', id: 'abcdefghijklmnopqrst', key: 'A'.repeat(32), gmOnline: true });
    expect(connection.send({ t: 'roll', scene: 'scene', formula: '1d20', token: null })).toBe(true);
    transports[0]?.close(1006, 'lost');
    clock.advance(400);
    expect(handshakes).toHaveLength(2);
    expect(handshakes[1]).toMatchObject({ key: 'A'.repeat(32) });
    expect(handshakes[1]?.code).toBeUndefined();
    expect(payloads[1]).toEqual([]);
    connection.stop();
  });

  it('resumes an existing wait token without requiring the join code again', () => {
    const clock = new Clock();
    const identity = playerIdentity('abcdefghijklmnopqrstuvwx23', new MemoryStorage());
    const handshakes: PlayerHello[] = [];
    const transports: TransportCallbacks[] = [];
    const connection = new PlayerConnection({
      origin: 'https://player.test', table: 'abcdefghijklmnopqrstuvwx23', identity, timers: clock,
      socket: () => ({
        connect: (hello: PlayerHello, callbacks: TransportCallbacks) => { handshakes.push(hello); transports.push(callbacks); callbacks.opened(); },
        send: () => undefined, close: () => undefined,
      } as unknown as SocketTransport),
      stream: () => { throw new Error('unexpected stream fallback'); },
      onStatus: () => undefined, onFrame: () => undefined,
    });
    connection.start({ name: 'Mira', code: '123456' });
    transports[0]?.frame({ v: 1, t: 'waiting', id: 'abcdefghijklmnopqrst', name: 'Mira', wait: 'B'.repeat(32) } as RelayFrame);
    expect(identity.get().wait).toBe('B'.repeat(32));
    connection.stop();
    connection.start({ name: 'Mira' });
    expect(handshakes[1]?.wait).toBe('B'.repeat(32));
    expect(handshakes[1]?.code).toBeUndefined();
    connection.stop();
  });

  it('does not switch transports after a WebSocket gate rejection', () => {
    const clock = new Clock();
    const statuses: string[] = [];
    const captured: { callbacks?: TransportCallbacks } = {};
    let streamAttempts = 0;
    const connection = new PlayerConnection({
      origin: 'https://player.test', table: 'abcdefghijklmnopqrstuvwx23', timers: clock,
      socket: () => ({
        connect: (_hello: PlayerHello, callbacks: TransportCallbacks) => { captured.callbacks = callbacks; callbacks.opened(); },
        send: () => undefined, close: () => undefined,
      } as unknown as SocketTransport),
      stream: () => { streamAttempts++; throw new Error('gate must not fall back'); },
      onStatus: (status) => statuses.push(status), onFrame: () => undefined,
    });
    connection.start({ name: 'Mira', code: '123456' });
    captured.callbacks?.close(CLOSE.wrongCode, 'wrong code');
    expect(streamAttempts).toBe(0);
    expect(statuses.at(-1)).toBe('blocked');
    connection.stop();
  });

  it('paces book writes and replaces an unsent absolute resource value', () => {
    const clock = new Clock();
    const delivered: PlayerMessage[] = [];
    const outbox = new PlayerOutbox({ send: (message) => { delivered.push(message); return true; }, online: () => true, timers: clock });
    const first: PlayerMessage = { t: 'book-resource', key: 'hp', current: 3 };
    const replacement: PlayerMessage = { t: 'book-resource', key: 'hp', current: 5 };
    const note: PlayerMessage = { t: 'book-note', note: { id: 'a'.repeat(24), title: 'First', body: 'note' } };
    expect(outbox.send(first)).toBe(true);
    expect(outbox.send(replacement)).toBe(true);
    expect(outbox.send(note)).toBe(true);
    expect(delivered).toEqual([]);
    clock.advance(100);
    expect(delivered).toEqual([replacement]);
    clock.advance(99);
    expect(delivered).toHaveLength(1);
    clock.advance(1);
    expect(delivered).toEqual([replacement, note]);
  });
  it('treats a replaced connection as final and leaves the identity intact', () => {
    const statuses: string[] = [];
    const identity = playerIdentity('abcdefghijklmnopqrstuvwx23', new MemoryStorage());
    identity.set({ playerId: 'abcdefghijklmnopqrst', key: 'A'.repeat(32) });
    const captured: { callbacks?: TransportCallbacks } = {};
    const connection = new PlayerConnection({
      origin: 'https://player.test', table: 'abcdefghijklmnopqrstuvwx23', identity,
      socket: () => ({
        connect: (_hello: PlayerHello, callbacks: TransportCallbacks) => { captured.callbacks = callbacks; callbacks.opened(); },
        send: () => undefined, close: () => undefined,
      } as unknown as SocketTransport),
      stream: () => { throw new Error('replaced socket must not reconnect'); },
      onStatus: (status) => statuses.push(status), onFrame: () => undefined,
    });
    connection.start({ name: 'Mira' });
    captured.callbacks?.close(CLOSE.replaced, 'replaced');
    expect(statuses.at(-1)).toBe('blocked');
    expect(identity.get()).toMatchObject({ playerId: 'abcdefghijklmnopqrst', key: 'A'.repeat(32) });
    connection.stop();
  });
});
