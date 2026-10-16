import { describe, expect, it, vi } from 'vitest';
import { SheetRolls, type SheetAuthority } from '../../../../src/app/online/gm/book/SheetRolls';
import type { SharedSheet, PlayerSheetMessage, GmMessage, RollMode } from '../../../../src/app/online/protocol';
import { rollDiceFormula, rollingWith } from '../../../../src/app/tools/DiceTool';
import type { DiceRollResult } from '../../../../src/app/types/diceTypes';
import type { LoggedRoll } from '../../../../src/app/online/gm/log/TableLog';

const sheet: SharedSheet = {
  revision: 'a'.repeat(24), name: 'Hero', fields: { dex: 3 }, images: {},
  template: { format: 'atlas-statblock-template', version: 1, id: 'opaque', fields: [], layout: { maxColumns: 1, blocks: [] } },
  rolls: [{ key: '["dex",["dex"],0]', index: 0, formula: '+3', label: 'Dexterity' }],
};

function fixture(): { handler: SheetRolls; authority: { current: SheetAuthority | null }; rolls: DiceRollResult[]; log: LoggedRoll[]; sent: GmMessage[]; random: () => number; draws: () => number; queued: PlayerSheetMessage[] } {
  const authority: { current: SheetAuthority | null } = { current: { sheet, character: 'hero', scene: 'scene', mapPath: 'map', tokenId: 'hero', tokenAlias: 'alias', sourcePath: 'Hero.md', rules: { defaultRoll: '1d20', crit: 'natural' }, set: { id: 'custom', name: 'Dual', builtIn: false, dice: [{ count: 2, sides: 12 }], crit: 'doubles' } } };
  const rolls: DiceRollResult[] = [];
  const log: LoggedRoll[] = [];
  const sent: GmMessage[] = [];
  const queued: PlayerSheetMessage[] = [];
  let count = 0;
  const random = (): number => { count++; return 0.5; };
  const handler = new SheetRolls({
    current: () => authority.current,
    dice: () => ({ viewId: 'view', rules: () => authority.current!.rules, on: vi.fn(), off: vi.fn(), rollDice: (formula, source, _origin, options) => {
      const context = authority.current!;
      const rolling = rollingWith(context.rules, options?.set);
      const result = rollDiceFormula(formula, rolling.rules, { random: options?.random ?? random, rollId: () => 'roll', roller: () => 'alice', onFormulaError: vi.fn() }, rolling.shown);
      if (result) { if (source !== undefined) result.source = source; rolls.push(result); }
      return result;
    } }),
    actionAllowed: () => true, defer: (request) => { queued.push(request.message); return true; }, send: (body) => sent.push(body), refresh: vi.fn(),
    rollAs: (_from, run) => run(), logged: (entry) => log.push(entry), randomId: () => 'roll', random,
  });
  return { handler, authority, rolls, log, sent, random, draws: () => count, queued };
}

describe('native indexed sheet rolls', () => {
  it('uses the same template dice and bonus once in every audience without resource writes', () => {
    for (const mode of ['public', 'gm', 'blind', 'self'] as const satisfies readonly RollMode[]) {
      const f = fixture();
      const request: PlayerSheetMessage = { t: 'sheet-roll', sheet: sheet.revision, index: 0, mode };
      f.handler.receive('alice', request);
      expect(f.draws()).toBe(0);
      f.handler.apply('alice', f.queued[0]!);
      const rolled = mode === 'public' ? f.rolls[0] : f.log[0]?.roll;
      expect(rolled).toMatchObject({ total: 17, source: { type: 'statblock', abilityName: 'Dexterity' } });
      expect(rolled?.rolls.map(({ max }) => max)).toEqual([12, 12]);
      if (mode === 'public') expect(rolled).toMatchObject({ diceSet: { id: 'custom', name: 'Dual' } });
      expect(f.draws()).toBe(2);
      if (mode !== 'public') expect(f.log[0]).toMatchObject({ flavor: 'Dexterity', to: mode === 'self' ? ['alice'] : ['gm'] });
      expect(f.rolls).toHaveLength(mode === 'public' ? 1 : 0);
      expect(f.log).toHaveLength(mode === 'public' ? 0 : 1);
      if (mode === 'blind') expect(f.sent).toEqual([]);
    }
  });

  it('does not draw for stale revisions, missing indices or lost current ownership after deferral', () => {
    const f = fixture();
    f.handler.receive('alice', { t: 'sheet-roll', sheet: 'b'.repeat(24), index: 0, mode: 'self' });
    f.handler.receive('alice', { t: 'sheet-roll', sheet: sheet.revision, index: 1, mode: 'self' });
    f.handler.receive('alice', { t: 'sheet-roll', sheet: sheet.revision, index: 0, mode: 'self' });
    f.authority.current = null;
    f.handler.apply('alice', f.queued[0]!);
    expect(f.draws()).toBe(0);
    expect(f.log).toEqual([]);
    expect(f.sent.every((body) => body.t === 'roll-refused')).toBe(true);
  });
});
