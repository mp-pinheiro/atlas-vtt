import { describe, expect, it } from 'vitest';
import { ASSET_CHUNK_BYTES } from '../../src/app/online/protocol/asset.ts';
import { PlayerRouter } from '../src/connection/playerRouter.ts';
import { createPlayerStore } from '../src/state/playerStore.ts';
import type { StoreApi } from 'zustand/vanilla';
import type { PlayerState } from '../src/state/playerStore.ts';
import type { PlayerMessage } from '../../src/app/online/protocol/game';

const scene = 's';
const channels = [
  { t: 'tokens', scene, seq: 1, tokens: [], cell: 70, snap: null },
  { t: 'fog', scene, seq: 1, fog: null },
  { t: 'sight', scene, seq: 1, lighting: { ambient: 0 }, lights: [], tokens: [], held: [] },
  { t: 'lighting', scene, cellSize: 70, unitDistance: 5, walls: [], zones: [], senses: [] },
  { t: 'mine', scene, tokens: [] },
  { t: 'grid', scene, grid: null },
  { t: 'doors', scene, doors: [] },
  { t: 'sensed', scene, tokens: [] },
  { t: 'pins', scene, pins: [] },
  { t: 'annotations', scene, drawings: [], texts: [] },
  { t: 'rules', scene, grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 }, snap: true, measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 }, accent: null },
  { t: 'agency', scene, permissions: { approval: false, perPlayerVision: true, playerConditions: false, playerDoors: false }, conditions: [], values: {} },
] as const;
const delta = (seq: number): unknown => ({ t: 'delta', scene, of: 'tokens', seq, lists: { tokens: { remove: [], upsert: [], order: [] } }, set: {}, unset: [] });
function fixture(personal = true): { store: StoreApi<PlayerState>; router: PlayerRouter; sent: PlayerMessage[]; receive: (body: unknown) => void } {
  const store = createPlayerStore();
  store.getState().beginScene({ id: scene, map: null, lit: true, ...(personal ? { personal: true } : {}) });
  const sent: PlayerMessage[] = [];
  const router = new PlayerRouter({ store, send: (message) => { sent.push(message); return true; } });
  return { store, router, sent, receive: (body) => router.receive({ v: 1, t: 'game', body }) };
}
function part(body: unknown, id: string): readonly unknown[] {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const split = Math.floor(bytes.length / 2);
  return [bytes.slice(0, split), bytes.slice(split)].map((value, index) => ({ t: 'part', id, index, count: 2, data: btoa(String.fromCharCode(...value)) }));
}

describe('atomic recipient picture safety', () => {
  it('does not publish an incomplete multipart picture or channel side effects', () => {
    const f = fixture();
    const parts = part({ t: 'picture', scene, whole: true, revision: 1, messages: channels }, 'whole');
    f.receive(parts[0]);
    expect(f.store.getState().scene?.pictureRevision).toBe(0);
    expect(f.store.getState().scene?.tokens).toBeNull();
    f.receive(parts[1]);
    expect(f.store.getState().scene?.pictureRevision).toBe(1);
    expect(f.store.getState().scene?.covered).toBe(false);
    f.router.destroy();
  });

  it('covers revision gaps without advancing delta bases and accepts a whole recovery at the same revision', () => {
    const f = fixture();
    f.receive({ t: 'picture', scene, whole: true, revision: 4, messages: channels });
    f.receive({ t: 'picture', scene, whole: false, revision: 6, messages: [delta(2)] });
    expect(f.store.getState().scene?.pictureRevision).toBe(4);
    expect(f.store.getState().scene?.covered).toBe(true);
    expect(f.sent).toEqual([{ t: 'picture-resync', scene }]);
    f.receive({ t: 'picture', scene, whole: false, revision: 5, messages: [delta(2)] });
    expect(f.store.getState().scene?.pictureRevision).toBe(4);
    f.receive({ t: 'picture', scene, whole: true, revision: 4, messages: channels });
    f.receive({ t: 'picture', scene, whole: false, revision: 5, messages: [delta(2)] });
    expect(f.store.getState().scene?.pictureRevision).toBe(5);
    expect(f.store.getState().scene?.tokens?.seq).toBe(2);
    f.router.destroy();
  });

  it('does not let legacy personal channels clear a failed picture cover', () => {
    const f = fixture();
    f.receive({ t: 'picture', scene, whole: true, revision: 1, messages: channels });
    f.receive({ t: 'picture', scene, whole: false, revision: 2, messages: [delta(3), { t: 'mine', scene, tokens: ['new-owner'] }] });
    expect(f.store.getState().scene?.mine?.tokens).toEqual([]);
    expect(f.store.getState().scene?.pictureRevision).toBe(1);
    for (const channel of channels) f.receive(channel);
    expect(f.store.getState().scene?.covered).toBe(true);
    expect(f.sent).toEqual([{ t: 'picture-resync', scene }]);
    f.router.destroy();
  });

  it('closes a malformed picture instead of retaining a usable stale picture', () => {
    const f = fixture();
    f.receive({ t: 'picture', scene, whole: true, revision: 1, messages: channels });
    f.receive({ t: 'picture', scene, whole: true, revision: 2, messages: [] });
    expect(f.store.getState().scene?.covered).toBe(true);
    expect(f.sent).toEqual([{ t: 'picture-resync', scene }]);
    f.router.destroy();
  });

  it('retains multipart book and log messages across a normal scene switch', () => {
    const f = fixture();
    const log = part({ t: 'log', entries: [] }, 'table-log');
    const book = part({ t: 'book', book: { character: null, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: { hidden: [], own: [] }, equipped: [] } }, 'table-book');
    const tokens = part(channels[0], 'scene-tokens');
    f.receive(log[0]);
    f.receive(book[0]);
    f.receive(tokens[0]);
    f.store.getState().beginScene({ id: 'other', map: null, lit: false });
    f.receive(log[1]);
    f.receive(book[1]);
    f.receive(tokens[1]);
    expect(f.store.getState().log).toEqual([]);
    expect(f.store.getState().book?.worldMap).toBeNull();
    expect(f.store.getState().scene?.tokens).toBeNull();
    f.router.destroy();
  });
  it('retains table messages across scene changes but drops scene and transport generation data', () => {
    const f = fixture();
    const people = part({ t: 'people', people: [] }, 'people');
    const tokens = part(channels[0], 'scene-tokens');
    f.receive(people[0]);
    f.receive(tokens[0]);
    f.store.getState().beginScene({ id: 'other', map: null, lit: false });
    f.receive(people[1]);
    f.receive(tokens[1]);
    expect(f.store.getState().people).toEqual({ t: 'people', people: [] });
    expect(f.store.getState().scene?.tokens).toBeNull();
    const later = part({ t: 'people', people: [{ id: 'abcdefghijklmnopqrst', name: 'Mira' }] }, 'later');
    f.receive(later[0]);
    f.store.getState().beginTransportGeneration();
    f.receive(later[1]);
    expect(f.store.getState().people).toEqual({ t: 'people', people: [] });
    f.router.destroy();
  });

  it('keeps only four incomplete multipart IDs and admits a new one after a slot is released', () => {
    const f = fixture();
    const text = JSON.stringify({ t: 'people', people: [{ id: 'abcdefghijklmnopqrst', name: 'Rhea' }] });
    const payload = new TextEncoder().encode(text);
    const base64 = (value: Uint8Array): string => {
      let binary = '';
      for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
      return btoa(binary);
    };
    const sendPart = (id: string, index: number, count: number, data: string): void => f.receive({ t: 'part', id, index, count, data });
    for (let index = 0; index < 4; index += 1) sendPart(`held-${index}`, 0, 2, 'eA==');
    sendPart('fifth', 0, 2, base64(payload));
    sendPart('fifth', 1, 2, '');
    expect(f.store.getState().people).toBeNull();
    sendPart('held-0', 1, 2, '');
    sendPart('fifth', 0, 2, base64(payload));
    sendPart('fifth', 1, 2, '');
    expect(f.store.getState().people).toEqual({ t: 'people', people: [{ id: 'abcdefghijklmnopqrst', name: 'Rhea' }] });
    f.router.destroy();
  });

  it('caps aggregate incomplete multipart bytes across assemblies', () => {
    const f = fixture();
    const chunkBytes = new Uint8Array(ASSET_CHUNK_BYTES).fill(32);
    const base64 = (value: Uint8Array): string => {
      let binary = '';
      for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
      return btoa(binary);
    };
    const blankChunk = base64(chunkBytes);
    for (let index = 0; index < 63; index += 1) f.receive({ t: 'part', id: 'near-limit', index, count: 64, data: blankChunk });
    const valid = JSON.stringify({ t: 'people', people: [{ id: 'abcdefghijklmnopqrst', name: 'Rhea' }] });
    const encoded = new TextEncoder().encode(valid);
    const padded = new Uint8Array(ASSET_CHUNK_BYTES);
    padded.set(encoded);
    padded.fill(32, encoded.length);
    f.receive({ t: 'part', id: 'over-limit', index: 0, count: 64, data: base64(padded) });
    f.receive({ t: 'part', id: 'over-limit', index: 1, count: 64, data: base64(new Uint8Array([32])) });
    for (let index = 2; index < 64; index += 1) f.receive({ t: 'part', id: 'over-limit', index, count: 64, data: '' });
    expect(f.store.getState().people).toBeNull();
    f.router.destroy();
  });

  it('keeps a missing legacy channel unusable until its whole channel returns', () => {
    const f = fixture(false);
    for (const channel of channels) f.receive(channel);
    f.receive(delta(4));
    expect(f.store.getState().scene?.tokens).toBeNull();
    f.receive(channels[1]);
    expect(f.store.getState().scene?.covered).toBe(true);
    f.receive({ ...channels[0], seq: 4 });
    f.receive(delta(5));
    expect(f.store.getState().scene?.tokens?.seq).toBe(5);
    expect(f.sent).toEqual([{ t: 'resync', scene, of: 'tokens' }]);
    f.router.destroy();
  });

  it('withdraws marks and old required channels on transport replacement', () => {
    const f = fixture(false);
    f.receive(channels[0]);
    f.store.getState().beginTransportGeneration();
    expect(f.store.getState().scene?.tokens).toBeNull();
    expect(f.store.getState().scene?.marks).toBeNull();
    f.receive(channels[1]);
    expect(f.store.getState().scene?.covered).toBe(true);
    f.router.destroy();
  });
});
