// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BookQuest, GmMessage } from '../../../../src/app/online/protocol/index.ts';
import { parseClientFrame, parseGmMessage, parseSharedSheet } from '../../../../src/app/online/protocol/index.ts';
import type { Timers } from '../../../../src/app/online/gm/companionTimers.ts';
import { BULK_BUFFERED, SendQueue } from '../../../../src/app/online/gm/sendQueue.ts';
import { BookShare } from '../../../../src/app/online/gm/book/BookShare.ts';
import { BookShelf } from '../../../../src/app/online/gm/book/BookShelf.ts';
import type { BookScene } from '../../../../src/app/online/gm/book/bookScene.ts';
import type { SheetProjection } from '../../../../src/app/online/gm/book/sheetProjection.ts';
import type { KnownPlayer } from '../../../../src/app/online/gm/ownership.ts';
import type { TokenEntity } from '../../../../src/app/types';
import type { ShownRollToken } from '../../../../src/app/services/playerRollSource';
import { settled } from './settled.ts';

const ALICE = 'anaanaanaanaanaanaan';
const BOB = 'benbenbenbenbenbenbe';
const PRIVATE_BIOGRAPHY = 'NEVER_DELIVERED_PRIVATE_BIOGRAPHY';
const PRIVATE_SHEET = parseSharedSheet({
  revision: 'a'.repeat(24),
  name: 'Private hero',
  template: { format: 'atlas-statblock-template', version: 1, id: 'opaque', fields: [], layout: { maxColumns: 1, blocks: [] } },
  fields: { privateBiography: PRIVATE_BIOGRAPHY },
  images: {},
  rolls: [],
});
if (PRIVATE_SHEET === null) throw new Error('Invalid private sheet fixture');
const PROJECTION: SheetProjection = { sheet: PRIVATE_SHEET, assets: new Map() };
const HERO: TokenEntity = {
  id: 'hero', kind: 'character', name: 'Private hero', imagePath: 'private/hero.webp', x: 100, y: 100, size: 1, statblockPath: 'private/Hero.md',
} as unknown as TokenEntity;
const SHOWN: ShownRollToken = { name: 'Private hero', imagePath: HERO.imagePath, showRing: false, ringColor: undefined };
const QUEST: BookQuest = { id: 'c'.repeat(24), kind: 'main', state: 'open', title: 'Public quest', body: 'A table-wide note.', place: null, xp: 300, rewards: [] };

interface TestTimers extends Timers {
  advance(ms: number): void;
}

interface TestSocket {
  bufferedAmount: number;
  readonly sent: string[];
  send(text: string): void;
}

interface SentBookMessage {
  readonly to: string;
  readonly body: GmMessage;
  readonly valid: (() => boolean) | undefined;
}

interface BookRig {
  readonly book: BookShare;
  readonly queue: SendQueue;
  readonly timers: TestTimers;
  readonly sent: SentBookMessage[];
  setOwner(owner: string): void;
  setQuests(quests: readonly BookQuest[]): void;
}

function testTimers(): TestTimers {
  let now = 0;
  let nextId = 0;
  const scheduled = new Map<number, { readonly at: number; readonly run: () => void }>();
  return {
    now: () => now,
    setTimer: (run, ms) => {
      nextId += 1;
      scheduled.set(nextId, { at: now + ms, run });
      return nextId;
    },
    clearTimer: (timer) => void scheduled.delete(timer),
    advance: (ms) => {
      const end = now + ms;
      for (;;) {
        const next = [...scheduled.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (next === undefined) break;
        now = next[1].at;
        scheduled.delete(next[0]);
        next[1].run();
      }
      now = end;
    },
  };
}

function bookRig(readSheet: () => Promise<SheetProjection | null>): BookRig {
  const timers = testTimers();
  const sent: SentBookMessage[] = [];
  const people: KnownPlayer[] = [
    { id: ALICE, name: 'Alice', online: true },
    { id: BOB, name: 'Bob', online: true },
  ];
  const tokens = { [HERO.id]: HERO };
  const scene: BookScene = {
    collection: 'Campaign',
    mapPath: 'Scenes/Cave.atlasmap',
    tokens,
    resources: [],
    shown: (ids) => new Map(ids.flatMap((id) => id === HERO.id ? [[id, SHOWN] as const] : [])),
  };
  let owner = ALICE;
  let quests: readonly BookQuest[] = [];
  const queue = new SendQueue(timers);
  const book = new BookShare({
    ...timers,
    send: (body, to, valid) => {
      sent.push({ to, body, valid });
      const entry = JSON.stringify({ to, body });
      const frame = JSON.stringify({ v: 1, t: 'send', to, body });
      queue.push(frame, to, entry, valid === undefined ? undefined : { recipient: to, valid });
    },
    clock: () => 0,
    randomId: () => 'd'.repeat(24),
    scene: () => scene,
    players: () => people,
    ownerOf: (tokenId) => tokenId === HERO.id ? owner : undefined,
    readImage: async () => null,
    stat: () => null,
    worldMap: async () => null,
    quests: async () => quests,
    questAsset: () => undefined,
    editResource: () => undefined,
    nativeSheet: () => readSheet(),
  }, new BookShelf());
  return {
    book,
    queue,
    timers,
    sent,
    setOwner: (next) => { owner = next; book.update(); },
    setQuests: (next) => { quests = next; book.questsChanged(); },
  };
}

function testSocket(): TestSocket {
  const sent: string[] = [];
  return { bufferedAmount: BULK_BUFFERED + 1, sent, send: (text) => sent.push(text) };
}

async function startBlocked(rig: BookRig): Promise<TestSocket> {
  const socket = testSocket();
  rig.queue.attach(socket);
  rig.book.start();
  await settled();
  return socket;
}

async function drain(rig: BookRig, socket: TestSocket): Promise<void> {
  socket.bufferedAmount = 0;
  rig.timers.advance(20);
  await settled();
}

function messagesFor(socket: TestSocket, recipient: string): GmMessage[] {
  const messages: GmMessage[] = [];
  for (const text of socket.sent) {
    const frame = parseClientFrame(text);
    if (frame?.t !== 'send' || frame.to !== recipient) continue;
    const message = parseGmMessage(frame.body);
    expect(message).not.toBeNull();
    if (message !== null) messages.push(message);
  }
  return messages;
}

describe('queued player book authority', () => {
  it('drops a revoked character snapshot at SendQueue flush while preserving the public quest part', async () => {
    const pending = Promise.withResolvers<SheetProjection | null>();
    const rig = bookRig(() => pending.promise);
    const socket = await startBlocked(rig);
    pending.resolve(PROJECTION);
    await settled();
    const alicePrivate = rig.sent.find(({ to, body }) => to === ALICE && body.t === 'book-sheet' && JSON.stringify(body).includes(PRIVATE_BIOGRAPHY));
    expect(alicePrivate).toBeDefined();
    const personal = rig.sent.filter(({ body }) => body.t === 'book' || body.t === 'book-sheet');
    expect(personal.every(({ valid }) => valid !== undefined)).toBe(true);

    rig.book.receive(ALICE, { t: 'book-parts' });
    rig.setQuests([QUEST]);
    await settled();
    const publicPart = rig.sent.find(({ to, body }) => to === ALICE && body.t === 'book-quests');
    expect(publicPart?.valid).toBeUndefined();

    rig.setOwner(BOB);
    await settled();
    expect(rig.sent.some(({ to, body }) => to === ALICE && body.t === 'book' && body.book.character === null)).toBe(true);
    await drain(rig, socket);

    const aliceMessages = messagesFor(socket, ALICE);
    expect(JSON.stringify(aliceMessages)).not.toContain(PRIVATE_BIOGRAPHY);
    expect(aliceMessages.some((message) => message.t === 'book' && message.book.character === null)).toBe(true);
    expect(aliceMessages.some((message) => message.t === 'book-quests' && message.quests.some((quest) => quest.title === QUEST.title)), JSON.stringify(aliceMessages.map((message) => message.t))).toBe(true);
    expect(JSON.stringify(messagesFor(socket, BOB))).toContain(PRIVATE_BIOGRAPHY);
    rig.book.stop();
    rig.queue.detach();
  });

  it('rejects native fields when the ownership scope changes while the sheet read is awaiting', async () => {
    const pending = Promise.withResolvers<SheetProjection | null>();
    const rig = bookRig(() => pending.promise);
    const socket = await startBlocked(rig);
    rig.setOwner(BOB);
    pending.resolve(PROJECTION);
    await settled();
    await drain(rig, socket);

    expect(JSON.stringify(messagesFor(socket, ALICE))).not.toContain(PRIVATE_BIOGRAPHY);
    expect(JSON.stringify(messagesFor(socket, BOB))).toContain(PRIVATE_BIOGRAPHY);
    rig.book.stop();
    rig.queue.detach();
  });

  it('invalidates queued snapshots on player departure and book shutdown', async () => {
    const rig = bookRig(() => Promise.resolve(PROJECTION));
    const socket = await startBlocked(rig);
    const alicePrivate = rig.sent.find(({ to, body }) => to === ALICE && (body.t === 'book' || body.t === 'book-sheet') && JSON.stringify(body).includes(PRIVATE_BIOGRAPHY));
    expect(alicePrivate?.valid?.()).toBe(true);
    rig.book.playerLeft(ALICE);
    expect(alicePrivate?.valid?.()).toBe(false);
    rig.book.stop();
    expect(rig.sent.filter(({ to, body }) => to === BOB && body.t === 'book').every(({ valid }) => valid?.() === false)).toBe(true);
    await drain(rig, socket);
    expect(messagesFor(socket, ALICE)).toEqual([]);
    expect(messagesFor(socket, BOB)).toEqual([]);
    rig.queue.detach();
  });
});
