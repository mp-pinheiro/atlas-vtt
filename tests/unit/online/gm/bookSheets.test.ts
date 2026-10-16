import { describe, expect, it } from 'vitest';
import { BookSheets } from '../../../../src/app/online/gm/book/bookSheets';
import type { SheetProjection } from '../../../../src/app/online/gm/book/sheetProjection';
import type { Character } from '../../../../src/app/types';

const token: Character = { id: 'hero', kind: 'character', name: 'Hero', imagePath: 'hero.png', x: 0, y: 0, size: 1, statblockPath: 'Hero.md' };
const sheet: SheetProjection = {
  sheet: { revision: 'a'.repeat(24), name: 'Hero', fields: { str: 3 }, images: {}, rolls: [{ key: '["str",["str"],0]', index: 0, formula: '+3', label: 'Strength' }],
    template: { format: 'atlas-statblock-template', version: 1, id: 'template', fields: [], layout: { maxColumns: 1, blocks: [] } },
  }, assets: new Map(), context: 'rules-one',
};

function fixture(): { cache: BookSheets; current: { scope: string; allowed: boolean }; reads: PromiseWithResolvers<SheetProjection | null>[] } {
  const current = { scope: 'first', allowed: true };
  const reads: PromiseWithResolvers<SheetProjection | null>[] = [];
  let revision = 0;
  const cache = new BookSheets({
    read: () => { const read = Promise.withResolvers<SheetProjection | null>(); reads.push(read); return read.promise; },
    current: (_token, scope) => current.allowed && current.scope === scope,
    randomId: () => (++revision).toString(16).padStart(24, '0'), changed: () => undefined,
  });
  return { cache, current, reads };
}

describe('native sheet projection authority', () => {
  it('withdraws the previous roll revision before a changed character or dice context finishes reading', async () => {
    const f = fixture();
    expect(f.cache.get(token, 'first')).toBeNull();
    f.reads[0]!.resolve(sheet); await f.reads[0]!.promise;
    const original = f.cache.get(token, 'first');
    expect(original?.rolls[0]?.formula).toBe('+3');
    f.current.scope = 'changed-character-and-dice';
    expect(f.cache.get(token, f.current.scope)).toBeNull();
    const stale = f.reads[1]!, fresh = f.reads[2]!;
    stale.resolve({ ...sheet, sheet: { ...sheet.sheet, name: 'Stale hero' } }); await stale.promise;
    expect(f.cache.get(token, f.current.scope)).toBeNull();
    fresh.resolve({ ...sheet, context: 'rules-two', sheet: { ...sheet.sheet, name: 'Current hero' } }); await fresh.promise;
    const current = f.cache.get(token, f.current.scope);
    expect(current?.name).toBe('Current hero');
    expect(current?.revision).not.toBe(original?.revision);
    f.cache.stop();
  });

  it('does not publish a projection whose owner or visible placement was lost during its read', async () => {
    const f = fixture();
    f.cache.get(token, 'first');
    f.current.allowed = false;
    f.reads[0]!.resolve(sheet); await f.reads[0]!.promise;
    expect(f.cache.get(token, 'first')).toBeNull();
    f.cache.stop();
  });

  it('rejects a stopped projection and does not reuse its revision after restart', async () => {
    const f = fixture();
    f.cache.get(token, 'first');
    const old = f.reads[0]!;
    f.cache.stop();
    old.resolve(sheet); await old.promise;
    expect(f.cache.get(token, 'first')).toBeNull();
    f.reads[1]!.resolve({ ...sheet, sheet: { ...sheet.sheet, name: 'Restarted hero' } }); await f.reads[1]!.promise;
    expect(f.cache.get(token, 'first')?.name).toBe('Restarted hero');
    f.cache.stop();
  });
});
