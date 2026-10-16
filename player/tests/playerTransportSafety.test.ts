import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionLine } from '../../src/app/online/protocol/stream.ts';
import type { PlayerMessage } from '../../src/app/online/protocol/game.ts';
import { StreamTransport } from '../src/transports/streamTransport.ts';
import { PlayerOutbox } from '../src/connection/playerOutbox.ts';
import type { ConnectionTimers } from '../src/state/interfaces.ts';
import { PlayerConnection } from '../src/connection/playerConnection.ts';
import { playerIdentity } from '../src/storage/playerIdentity.ts';
import type { SocketTransport, TransportCallbacks } from '../src/transports/socketTransport.ts';
import type { PlayerHello } from '../../src/app/online/protocol/relay.ts';

const hello = { v: 1, t: 'hello', role: 'player', name: 'Mira', code: '123456', waits: true } as const;
const origin = 'https://player.test';
const table = 'abcdefghijklmnopqrstuvwx23';
function downstream(): { response: Response; close: () => void } {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value): void { controller = value; value.enqueue(new TextEncoder().encode(sessionLine('A'.repeat(43)))); } });
  return { response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }), close: () => controller.close() };
}
function timers(): { timers: ConnectionTimers; flush: () => void; advance: (ms: number) => void } {
  let now = 0;
  let serial = 0;
  const pending = new Map<number, () => void>();
  return {
    timers: {
      now: () => now, random: () => 0.5,
      setTimeout: (callback) => { pending.set(++serial, callback); return serial; },
      clearTimeout: (handle) => { pending.delete(handle as number); },
      setInterval: (callback) => { pending.set(++serial, callback); return serial; },
      clearInterval: (handle) => { pending.delete(handle as number); },
    },
    flush: () => { const batch = [...pending.values()]; pending.clear(); for (const callback of batch) callback(); },
    advance: (ms) => { now += ms; },
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('stream uncertain-write isolation', () => {
  it('allows one executing POST and drops the queued tail after an uncertain failure', async () => {
    const opened = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const firstPost = Promise.withResolvers<Response>();
    const feed = downstream();
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: URL): Promise<Response> => {
      if (!String(url).endsWith('/send')) return feed.response;
      posts++;
      firstStarted.resolve();
      return firstPost.promise;
    }));
    const transport = new StreamTransport();
    transport.connect(origin, table, hello, { opened: () => opened.resolve(), frame: () => undefined, waiting: () => undefined, close: () => undefined });
    await opened.promise;
    const one = transport.send(origin, table, 'first');
    const two = transport.send(origin, table, 'second');
    const rejectedOne = expect(one).rejects.toThrow('uncertain');
    const rejectedTwo = expect(two).rejects.toThrow('uncertain');
    await firstStarted.promise;
    expect(posts).toBe(1);
    expect(transport.busy).toBe(true);
    firstPost.reject(new Error('uncertain'));
    await Promise.all([rejectedOne, rejectedTwo]);
    expect(posts).toBe(1);
    expect(transport.busy).toBe(false);
    transport.close();
    feed.close();
  });

  it('never executes a queued old-generation edit after a replacement stream opens', async () => {
    const firstOpen = Promise.withResolvers<void>();
    const secondOpen = Promise.withResolvers<void>();
    const postStarted = Promise.withResolvers<void>();
    const heldPost = Promise.withResolvers<Response>();
    const feeds = [downstream(), downstream()];
    let opens = 0;
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: URL): Promise<Response> => {
      if (!String(url).endsWith('/send')) return feeds[opens++]!.response;
      posts++;
      if (posts === 1) { postStarted.resolve(); return heldPost.promise; }
      return new Response(null, { status: 204 });
    }));
    const transport = new StreamTransport();
    const callbacks = { frame: (): void => undefined, waiting: (): void => undefined, close: (): void => undefined };
    transport.connect(origin, table, hello, { ...callbacks, opened: () => firstOpen.resolve() });
    await firstOpen.promise;
    const old = transport.send(origin, table, 'old');
    const queued = transport.send(origin, table, 'must-not-run');
    const rejected = expect(queued).rejects.toThrow('generation');
    await postStarted.promise;
    transport.connect(origin, table, hello, { ...callbacks, opened: () => secondOpen.resolve() });
    await secondOpen.promise;
    heldPost.resolve(new Response(null, { status: 204 }));
    await old;
    await rejected;
    await transport.send(origin, table, 'new');
    expect(posts).toBe(2);
    transport.close();
    for (const feed of feeds) feed.close();
  });
});

describe('bounded player outbox', () => {
  it('keeps only 128 unsent edits under transport backpressure and clears them on disconnect', () => {
    const clock = timers();
    const sent: PlayerMessage[] = [];
    const busy = vi.fn();
    let ready = false;
    const outbox = new PlayerOutbox({ send: (message) => { sent.push(message); return true; }, online: () => true, ready: () => ready, timers: clock.timers, onBusy: busy });
    for (let index = 0; index < 128; index++) expect(outbox.send({ t: 'claim-request', scene: 's', id: 'a'.repeat(24), request: index.toString(16).padStart(24, '0') })).toBe(true);
    expect(outbox.send({ t: 'claim-request', scene: 's', id: 'a'.repeat(24), request: 'f'.repeat(24) })).toBe(false);
    expect(busy).toHaveBeenLastCalledWith(true);
    outbox.clear();
    ready = true;
    clock.flush();
    expect(sent).toEqual([]);
  });

  it('does not retry a send whose application is uncertain', () => {
    const clock = timers();
    const send = vi.fn(() => false);
    const outbox = new PlayerOutbox({ send, online: () => true, timers: clock.timers });
    outbox.send({ t: 'roll', scene: 's', formula: '1d20', token: null });
    clock.advance(1000);
    clock.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('invalidates scene edits but retains table-scoped book edits on scene replacement', () => {
    const clock = timers();
    let ready = false;
    const sent: PlayerMessage[] = [];
    const outbox = new PlayerOutbox({ send: (message) => { sent.push(message); return true; }, online: () => true, ready: () => ready, timers: clock.timers });
    outbox.send({ t: 'roll', scene: 'old', formula: '1d20', token: null });
    outbox.send({ t: 'book-resource', key: 'hp', current: 3 });
    outbox.sceneChanged('new');
    ready = true;
    clock.flush();
    expect(sent).toEqual([{ t: 'book-resource', key: 'hp', current: 3 }]);
  });

  it('accounts for independent variant request slots and releases only the matching tuple', () => {
    const outbox = new PlayerOutbox({ send: () => true, online: () => true });
    const hash = 'a'.repeat(64);
    for (const maxSide of [256, 512, 1024, 2048]) expect(outbox.send({ t: 'asset-request', hash, maxSide })).toBe(true);
    expect(outbox.send({ t: 'asset-request', hash, maxSide: 4096 })).toBe(false);
    outbox.assetFinished(hash, 512);
    expect(outbox.send({ t: 'asset-request', hash, maxSide: 4096 })).toBe(true);
    expect(outbox.send({ t: 'asset-request', hash, maxSide: 8192 })).toBe(false);
    outbox.clear();
  });
});

describe('heartbeat timer suspension', () => {
  it('lets queued network events settle after a delayed pong deadline', () => {
    let now = 0;
    let serial = 0;
    let beat: (() => void) | null = null;
    const tasks = new Map<number, { readonly callback: () => void; readonly delay: number }>();
    const clock: ConnectionTimers = {
      now: () => now, random: () => 0.5,
      setTimeout: (callback, delay) => { tasks.set(++serial, { callback, delay }); return serial; },
      clearTimeout: (handle) => { tasks.delete(handle as number); },
      setInterval: (callback) => { beat = callback; return ++serial; },
      clearInterval: () => { beat = null; },
    };
    let callbacks: TransportCallbacks | null = null;
    const statuses: string[] = [];
    const connection = new PlayerConnection({
      origin, table, timers: clock, identity: playerIdentity(table, null),
      socket: () => ({
        connect: (_hello: PlayerHello, value: TransportCallbacks): void => { callbacks = value; value.opened(); },
        send: (): void => undefined, close: (): void => undefined,
      }) as unknown as SocketTransport,
      onStatus: (status): void => { statuses.push(status); }, onFrame: (): void => undefined,
    });
    connection.start({ name: 'Mira', code: '123456' });
    const socket = callbacks as unknown as TransportCallbacks;
    socket.frame({ v: 1, t: 'welcome', role: 'player', id: 'abcdefghijklmnopqrst', key: 'A'.repeat(32), gmOnline: true });
    now = 30_000;
    (beat as unknown as () => void)();
    const deadline = [...tasks.values()].find((task) => task.delay === 20_000);
    expect(deadline).toBeDefined();
    now = 100_000;
    deadline?.callback();
    expect([...tasks.values()].some((task) => task.delay === 1_000)).toBe(true);
    socket.pong?.();
    expect([...tasks.values()].some((task) => task.delay === 1_000)).toBe(false);
    expect(statuses.at(-1)).toBe('connected');
    connection.stop();
  });
});

it('withdraws unsent character resource and sheet edits on an identical character refresh', () => {
  const clock = timers();
  let ready = false;
  const sent: PlayerMessage[] = [];
  const outbox = new PlayerOutbox({ send: (message) => { sent.push(message); return true; }, online: () => true, ready: () => ready, timers: clock.timers });
  outbox.send({ t: 'book-resource', key: 'hp', current: 7 });
  outbox.send({ t: 'sheet-roll', sheet: 'a'.repeat(24), index: 0, mode: 'public' });
  const note: PlayerMessage = { t: 'book-note', note: { id: 'a'.repeat(24), title: 'Journal', body: 'Table note' } };
  outbox.send(note);
  outbox.characterChanged();
  outbox.characterChanged();
  ready = true;
  clock.flush();
  expect(sent).toEqual([note]);
});
