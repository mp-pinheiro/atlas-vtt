// @vitest-environment node
import { GM_AUTHOR, parseGmMessage, parseLogEntry, type GmMessage, type SharedRoll } from '../../../../src/app/online/protocol/index.ts';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../../src/app/online/gm/assetServe.ts';
import { ImageShare } from '../../../../src/app/online/gm/image/ImageShare.ts';
import { lootCardOf } from '../../../../src/app/online/gm/log/lootCard.ts';
import { TableLog } from '../../../../src/app/online/gm/log/TableLog.ts';
import type { LootDraw } from '../../../../src/app/loot/lootRoller';
import { settled } from './settled.ts';

const ANA = 'a'.repeat(20);
const BEN = 'b'.repeat(20);
const CAL = 'c'.repeat(20);
const ART = { hash: 'f'.repeat(64), size: 10, mime: 'image/png' };
const ROLL: SharedRoll = { id: 'roll_1', timestamp: 1, formula: '1d20', modifiers: 0, total: 14, rolls: [{ die: 'd20', value: 14, max: 20 }] };

interface Sent {
  readonly body: GmMessage;
  readonly to: string | undefined;
}

function log(): { log: TableLog; sent: Sent[] } {
  const sent: Sent[] = [];
  let id = 0;
  const made = new TableLog({
    send: (body, to) => void sent.push({ body, to }),
    clock: () => 1_700_000_000_000,
    now: () => 0,
    randomId: () => (id++).toString(16).padStart(24, '0'),
    nameOf: (player) => (player === ANA ? 'Ana' : null),
    setTimer: () => 1,
    clearTimer: () => undefined,
    changed: () => undefined,
  });
  made.welcome([{ id: ANA, name: 'Ana' }]);
  sent.length = 0;
  return { log: made, sent };
}

const DRAW: LootDraw = {
  id: 'draw-1', notePath: 'Secret/Loot/Sword.md', source: ['Treasure', 'Weapons'], name: 'Sword of [[Dawn]]', rarity: 'Rare', price: '120 gp',
  description: `A ${'very '.repeat(400)}old blade.`, properties: [{ label: 'Damage', value: '1d8' }, { label: '‮', value: 'x' }],
};

describe('what the GM showed or handed out', () => {
  it('an image goes to everyone by hash, its file stays with the GM, and the log lets it be served', () => {
    const { log: table, sent } = log();
    table.imageShown({ image: ART, width: 640, height: 480 }, 'Handouts/map.png');
    const message = sent[0]?.body;
    expect(sent[0]?.to).toBeUndefined();
    expect(message?.t === 'log-entry' ? message.entry : null).toMatchObject({ kind: 'image', who: 'gm', image: ART, width: 640, height: 480 });
    expect(JSON.stringify(message)).not.toContain('Handouts');
    expect(parseGmMessage(message)).toEqual(message);
    expect(table.artFile(ART.hash, GM_AUTHOR)).toBe('Handouts/map.png');
    expect(table.artFile(ART.hash, ANA)).toBe('Handouts/map.png');
    const kept = new TableLog({ ...{ send: () => undefined, clock: () => 0, now: () => 0, randomId: () => '0'.repeat(24), nameOf: () => null, setTimer: () => 1, clearTimer: () => undefined, changed: () => undefined } }, JSON.parse(JSON.stringify(table.saved())));
    expect(kept.artFile(ART.hash, GM_AUTHOR)).toBe('Handouts/map.png');
    table.clear();
    expect(table.artFile(ART.hash, ANA)).toBeUndefined();
  });

  it('an item goes to everyone as the text of its card, bounded, never its note or source', () => {
    const { log: table, sent } = log();
    const item = lootCardOf(DRAW);
    if (item === null) throw new Error('no card');
    expect(item.description?.length).toBeLessThanOrEqual(1500);
    expect(item.description?.endsWith('…')).toBe(true);
    expect(item.properties).toEqual([{ label: 'Damage', value: '1d8' }]);
    table.lootHanded(item);
    const message = sent[0]?.body;
    expect(message?.t === 'log-entry' ? message.entry : null).toMatchObject({ kind: 'loot', who: 'gm', item: { name: 'Sword of [[Dawn]]', rarity: 'Rare', price: '120 gp' } });
    expect(JSON.stringify(message)).not.toMatch(/Secret|Treasure|notePath|source/);
    expect(parseGmMessage(message)).toEqual(message);
  });

  it('only the GM shows or hands out: a player\'s image or loot entry is no entry', () => {
    const base = { id: '0'.repeat(24), at: 1, who: ANA, name: 'Ana' };
    expect(parseLogEntry({ ...base, kind: 'image', image: ART, width: 1, height: 1 })).toBeNull();
    expect(parseLogEntry({ ...base, kind: 'loot', item: { name: 'Rope', properties: [] } })).toBeNull();
    expect(parseLogEntry({ ...base, who: 'gm', name: 'GM', kind: 'loot', item: { name: 'Rope', properties: 'many' } })).toBeNull();
  });

  it('a shown image is served while the log holds it, as it was sent, and refused once it is gone', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
    const hash = await sha256Hex(png);
    const sent: Sent[] = [];
    const logged = new Map<string, string>();
    const share = new ImageShare({
      send: (body, to) => void sent.push({ body, to }), now: () => 0, randomId: () => '1'.repeat(24), changed: () => undefined,
      logShown: (shown, path) => void (path !== null && logged.set(shown.image.hash, path)),
      loggedFile: (asked) => logged.get(asked),
      readImage: () => Promise.resolve(null),
    });
    expect(await share.show(() => Promise.resolve({ bytes: png, mime: 'image/png' }), 'Handouts/a.png')).toBe('shown');
    expect(logged.get(hash)).toBe('Handouts/a.png');
    share.dismiss();
    sent.length = 0;
    expect(share.receive(ANA, { t: 'asset-request', hash })).toBe(true);
    const chunks = sent.flatMap(({ body }) => (body.t === 'asset-chunk' ? [Buffer.from(body.data, 'base64')] : []));
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(png);
    logged.clear();
    expect(share.receive(ANA, { t: 'asset-request', hash })).toBe(false);
  });
  it('serves private speaker art only to viewers of the whole log entry', async () => {
    const bytes = new Uint8Array([17, 23, 41, 59]);
    const hash = await sha256Hex(bytes);
    const { log: table } = log();
    table.welcome([{ id: ANA, name: 'Ana' }, { id: BEN, name: 'Ben' }]);
    table.rolled({
      who: ANA, roll: ROLL, token: null, shared: true, mode: 'blind', to: [BEN],
      speaker: { speaker: { name: 'Ana', token: null, art: { hash, size: bytes.length, mime: 'image/png' }, ring: null }, art: 'Private/ana.png' },
    });
    const sent: Sent[] = [];
    const share = new ImageShare({
      send: (body, to) => void sent.push({ body, to }), now: () => 0, randomId: () => '2'.repeat(24), changed: () => undefined,
      loggedFile: (asked, viewer) => table.artFile(asked, viewer),
      readImage: (path) => Promise.resolve(path === 'Private/ana.png' ? { bytes, mime: 'image/png' } : null),
    });
    for (const viewer of [ANA, CAL]) expect(share.receive(viewer, { t: 'asset-request', hash })).toBe(false);
    expect(sent).toEqual([]);
    expect(table.artFile(hash, BEN)).toBe('Private/ana.png');
    expect(share.receive(BEN, { t: 'asset-request', hash })).toBe(true);
    await settled();
    const chunks = sent.filter(({ body, to }) => body.t === 'asset-chunk' && to === BEN).flatMap(({ body }) => body.t === 'asset-chunk' ? [Buffer.from(body.data, 'base64')] : []);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(bytes);
  });

  it('drops an authorized download when its log entry is removed before the read finishes', async () => {
    const bytes = new Uint8Array([17, 23, 41, 59]);
    const hash = await sha256Hex(bytes);
    const { log: table } = log();
    table.welcome([{ id: ANA, name: 'Ana' }, { id: BEN, name: 'Ben' }]);
    table.rolled({
      who: ANA, roll: ROLL, token: null, shared: true, mode: 'blind', to: [BEN],
      speaker: { speaker: { name: 'Ana', token: null, art: { hash, size: bytes.length, mime: 'image/png' }, ring: null }, art: 'Private/ana.png' },
    });
    const read = Promise.withResolvers<{ bytes: Uint8Array<ArrayBuffer>; mime: 'image/png' } | null>();
    const sent: { readonly body: GmMessage; readonly valid: (() => boolean) | undefined }[] = [];
    const share = new ImageShare({
      send: (body, _to, valid) => sent.push({ body, valid }), now: () => 0, randomId: () => '3'.repeat(24), changed: () => undefined,
      loggedFile: (asked, viewer) => table.artFile(asked, viewer),
      readImage: () => read.promise,
    });
    expect(share.receive(BEN, { t: 'asset-request', hash })).toBe(true);
    table.clear();
    read.resolve({ bytes, mime: 'image/png' });
    await settled();
    expect(sent.filter(({ body }) => body.t === 'asset-chunk')).toEqual([]);
  });

  it('attaches a live authorization check to queued asset bytes', async () => {
    const bytes = new Uint8Array([17, 23, 41, 59]);
    const hash = await sha256Hex(bytes);
    const { log: table } = log();
    table.welcome([{ id: ANA, name: 'Ana' }, { id: BEN, name: 'Ben' }]);
    table.rolled({
      who: ANA, roll: ROLL, token: null, shared: true, mode: 'blind', to: [BEN],
      speaker: { speaker: { name: 'Ana', token: null, art: { hash, size: bytes.length, mime: 'image/png' }, ring: null }, art: 'Private/ana.png' },
    });
    const queued: { readonly body: GmMessage; readonly to: string | undefined; readonly valid: (() => boolean) | undefined }[] = [];
    const share = new ImageShare({
      send: (body, to, valid) => queued.push({ body, to, valid }), now: () => 0, randomId: () => '4'.repeat(24), changed: () => undefined,
      loggedFile: (asked, viewer) => table.artFile(asked, viewer),
      readImage: () => Promise.resolve({ bytes, mime: 'image/png' }),
    });
    expect(share.receive(BEN, { t: 'asset-request', hash })).toBe(true);
    await settled();
    const chunk = queued.find(({ body }) => body.t === 'asset-chunk');
    expect(chunk?.valid?.()).toBe(true);
    table.clear();
    const delivered = queued.filter(({ valid }) => valid?.() !== false);
    expect(delivered.some(({ body }) => body.t === 'asset-chunk')).toBe(false);
  });
});
