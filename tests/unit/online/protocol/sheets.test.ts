import { describe, expect, it } from 'vitest';
import { parseGmMessage, parsePlayerMessage, parseSharedSheet } from '../../../../src/app/online/protocol/index.ts';

const revision = 'a'.repeat(24);
const base = {
  revision, name: 'Hero',
  template: { format: 'atlas-statblock-template', version: 1, id: 'opaque-template', fields: [], layout: { maxColumns: 1, blocks: [] } },
  fields: { hp: 4 }, images: {}, rolls: [],
};

function sheetWithBlocks(blocks: readonly unknown[]): unknown {
  return { ...base, template: { ...base.template, layout: { maxColumns: 1, blocks } } };
}

describe('native sheet wire boundaries', () => {
  it('retains native table and choice definitions without retaining imported code or vault provenance', () => {
    const field = { key: 'stats', label: 'Stats', type: 'scores', slots: ['STR', 'DEX'], slotKeys: ['str', 'dex'], rows: [[12, 10]], align: ['center', null], addRows: false, addColumns: false };
    const source = { system: 'Rules', label: 'SRD', licences: ['CC-BY-4.0'], attribution: 'Required attribution', licenceUrl: 'https://example.org/license', modification: 'Native arrangement' };
    const read = parseSharedSheet({ ...base, template: { ...base.template, fields: [{ ...field, importedFrom: { fs: 'unsafe' } }], source: { ...source, sourceId: 'vault-secret' }, diceSetId: 'vault-dice', sample: { secret: 'not a field' } } });
    expect(read?.template.fields).toEqual([field]);
    expect(read?.template.source).toEqual(source);
    expect(read?.template).not.toHaveProperty('sample');
    expect(read?.template).not.toHaveProperty('diceSetId');
  });

  it.each([
    { id: 'a', type: 'title', field: 'name' },
    { id: 'a', type: 'stat', field: 'hp', look: 'anything' },
    { id: 'a', type: 'scores', field: 'stats', orientation: 'row', columns: [{ formula: 7 }] },
    { id: 'a', type: 'section', blocks: 'not children' },
    { id: 'a', type: 'rendered-script', blocks: [], fs: { javascript: 'unsafe' } },
    { id: 'a', type: 'opaque', raw: {} },
    { id: 'a', type: 'script', summary: 'unsafe', fs: {} },
    { id: 'a', type: 'text', text: 'safe', fsExtras: { source: 'unsafe' } },
  ])('rejects malformed native or executable block %j', (block) => {
    expect(parseSharedSheet(sheetWithBlocks([block]))).toBeNull();
  });

  it('accepts projected informational blocks and drops their non-native metadata', () => {
    const read = parseSharedSheet(sheetWithBlocks([{ id: 'parent', type: 'rendered-script', scriptId: 'vault-script', blocks: [{ id: 'child', type: 'text', text: 'Read on the GM', sourceId: 'vault-source' }] }]));
    expect(read?.template.layout.blocks).toEqual([{ id: 'parent', type: 'rendered-script', blocks: [{ id: 'child', type: 'text', text: 'Read on the GM' }] }]);
  });

  it('rejects global field budgets, nonfinite values, and prototype fields instead of changing their meaning', () => {
    expect(parseSharedSheet({ ...base, fields: { hp: Number.POSITIVE_INFINITY } })).toBeNull();
    expect(parseSharedSheet({ ...base, fields: JSON.parse('{"__proto__":{"secret":1}}') })).toBeNull();
    expect(parseSharedSheet({ ...base, fields: Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`f${index}`, Array.from({ length: 200 }, () => 1)])) })).toBeNull();
    expect(parseSharedSheet({ ...base, fields: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`f${index}`, 'x'.repeat(8000)])) })).toBeNull();
    expect(parseSharedSheet({ ...base, fields: { hp: null, abilities: [0, false, ''] } })?.fields).toEqual({ hp: null, abilities: [0, false, ''] });
  });

  it('rejects duplicate layout identities and depth or node overflow without truncating a sheet', () => {
    expect(parseSharedSheet(sheetWithBlocks([{ id: 'a', type: 'divider' }, { id: 'a', type: 'divider' }]))).toBeNull();
    const nested = (depth: number): unknown => depth === 0 ? { id: 'leaf', type: 'divider' } : { id: `node${depth}`, type: 'section', blocks: [nested(depth - 1)] };
    expect(parseSharedSheet(sheetWithBlocks([nested(15)]))?.template.layout.blocks[0]?.type).toBe('section');
    expect(parseSharedSheet(sheetWithBlocks([nested(16)]))).toBeNull();
    expect(parseSharedSheet(sheetWithBlocks(Array.from({ length: 2001 }, (_, index) => ({ id: `node${index}`, type: 'divider' }))))).toBeNull();
  });

  it('keeps ability labels distinct and rejects ambiguous roll keys or indexes', () => {
    const rolls = [{ key: '["a",["str"],0]', index: 0, formula: '+3', label: 'Strength' }, { key: '["a",["dex"],0]', index: 1, formula: '+3', label: 'Dexterity' }];
    expect(parseSharedSheet({ ...base, rolls })?.rolls).toEqual(rolls);
    expect(parseSharedSheet({ ...base, rolls: [rolls[0], { ...rolls[1], index: 0 }] })).toBeNull();
    expect(parseSharedSheet({ ...base, rolls: [rolls[0], { ...rolls[1], key: rolls[0]?.key }] })).toBeNull();
    for (const mode of ['public', 'gm', 'blind', 'self']) {
      expect(parsePlayerMessage({ t: 'sheet-roll', sheet: revision, index: 0, mode, formula: 'forged', label: 'forged' })).toEqual({ t: 'sheet-roll', sheet: revision, index: 0, mode });
    }
    expect(parsePlayerMessage({ t: 'sheet-roll', sheet: revision, index: 5000, mode: 'public' })).toBeNull();
    expect(parsePlayerMessage({ t: 'sheet-roll', sheet: revision, index: 0, mode: 'unknown' })).toBeNull();
    expect(parseGmMessage({ t: 'book-sheet', character: { statblock: { ...base, fields: { hp: Number.NaN } } } })).toBeNull();
  });
});
