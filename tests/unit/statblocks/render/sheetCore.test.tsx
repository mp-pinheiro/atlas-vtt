import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseSharedSheet, type SharedSheet } from '../../../../src/app/online/protocol/sheet';
import { TEMPLATE_FORMAT, type StatblockTemplate } from '../../../../src/app/statblocks/model/templateTypes';
import { StatblockSheetCore } from '../../../../src/app/statblocks/render/StatblockSheetCore';
import type { SheetRenderHost } from '../../../../src/app/statblocks/render/sheetRenderHost';
import { sheetRollSpecs } from '../../../../src/app/statblocks/render/sheetRollSpecs';
import { sharedSheetTemplate } from '../../../../src/app/statblocks/render/sharedSheetTemplate';
import { markdownRollSegments } from '../../../../src/app/statblocks/render/shared/markdownRollSegments';
import { sheetRollKey, toRollFormula } from '../../../../src/app/statblocks/render/shared/diceSegments';
import { StatblockSheet } from '../../../../src/app/statblocks/render/StatblockSheet';

vi.mock('../../../../src/app/statblocks/render/shared/useStatblockDiceRolling', () => ({ useStatblockDiceRolling: () => [undefined, null] }));

const TEMPLATE: StatblockTemplate = {
  format: TEMPLATE_FORMAT, version: 1, id: 'test-sheet',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'hp', label: 'Hit Points', type: 'number' },
    { key: 'hit_dice', label: 'Hit dice', type: 'dice' },
    { key: 'stats', label: 'Abilities', type: 'scores', slots: ['Strength', 'Dexterity'] },
    { key: 'actions', label: 'Actions', type: 'entries', entry: { extras: [{ key: 'cost', label: 'Cost', type: 'dice' }] } },
    { key: 'tags', label: 'Tags', type: 'list' },
    { key: 'saves', label: 'Saves', type: 'pairs' },
    { key: 'spells', label: 'Spells', type: 'spells' },
    { key: 'bonus', label: 'Bonus', type: 'text' },
    { key: 'body', label: 'Description', type: 'markdown' },
  ],
  layout: { maxColumns: 2, blocks: [
    { type: 'metric', id: 'metric01', fields: ['bonus'] },
    { type: 'scores', id: 'scores01', field: 'stats', orientation: 'table', columns: [{ formula: 'value - 10', display: 'signed', label: 'Modifier' }] },
    { type: 'entries', id: 'entries1', field: 'actions', introField: 'body' },
    { type: 'tags', id: 'tags0001', field: 'tags', look: 'chips' },
    { type: 'pairs', id: 'pairs001', field: 'saves', display: 'signed' },
    { type: 'spells', id: 'spells01', field: 'spells', look: 'tabs' },
    { type: 'tabs', id: 'tabs0001', blocks: [
      { type: 'section', id: 'tab00001', heading: 'First', blocks: [{ type: 'text', id: 'text0001', field: 'body' }] },
      { type: 'section', id: 'tab00002', heading: 'Second', blocks: [{ type: 'stat', id: 'stat0001', field: 'bonus', look: 'run-in' }] },
    ] },
    { type: 'stat', id: 'fallback', field: 'missing', look: 'run-in', whenEmpty: 'fallback', fallback: 'Roll 1d4' },
  ] },
};
const FIELDS = {
  name: 'Hero', hp: 20, hit_dice: '3d8 + 3', stats: [15, 13], bonus: '+3',
  body: 'Roll **1d6** or +3; `2d20` is code. [Help](https://example.com/1d100).',
  actions: [{ name: 'Claws', desc: 'Hit 1d8 + 3.', cost: '1d4' }, { name: 'Bite', desc: 'Hit 1d8 + 3.' }],
  tags: ['+2', '1d10'], saves: { dex: 3, con: 2 },
  spells: ['Spellcasting', { '1st': 'Bolt 1d6' }, { '2nd': 'Burst 2d6' }],
};

function collectingHost(seen: Array<{ key: string; formula: string }>): SheetRenderHost {
  const roll = (key: string, text: string, formula = text): React.ReactNode => {
    seen.push({ key, formula: toRollFormula(formula) });
    return <span data-sheet-roll={key}>{text}</span>;
  };
  return {
    roll,
    image: () => null,
    link: (label) => label,
    markdown: (text, context) => {
      if (context.dice === false) return text;
      const location: unknown = JSON.parse(context.key);
      if (!Array.isArray(location) || typeof location[0] !== 'string' || !Array.isArray(location[1])) throw new Error('Invalid render location');
      const path = location[1].filter((step): step is string | number => typeof step === 'string' || typeof step === 'number');
      let ordinal = 0;
      return markdownRollSegments(text).map((segment, index) => <React.Fragment key={index}>{segment.dice ? roll(sheetRollKey(location[0], path, ordinal++), segment.text) : segment.text}</React.Fragment>);
    },
  };
}

function projected(template: StatblockTemplate, fields: Record<string, unknown>): SharedSheet {
  const parsed = parseSharedSheet({ revision: 'a'.repeat(24), name: 'Test', template, fields, images: {}, rolls: [] });
  if (!parsed) throw new Error('Fixture sheet rejected');
  return parsed;
}

describe('native shared sheet core', () => {
  it('gives every actionable value exactly one pure registry entry across all tabs and compound values', () => {
    const seen: Array<{ key: string; formula: string }> = [];
    renderToStaticMarkup(<StatblockSheetCore template={TEMPLATE} fields={FIELDS} name="Test" variant="full" host={collectingHost(seen)} />);
    const specs = sheetRollSpecs(TEMPLATE, FIELDS);
    expect(new Set(seen.map((roll) => roll.key)).size).toBe(seen.length);
    expect(seen).toEqual(specs.map(({ key, formula }) => ({ key, formula })));
    expect(specs.some((spec) => spec.key === sheetRollKey('scores01', ['stats', 'columns', 0, 1], 0))).toBe(true);
    expect(specs.filter((spec) => spec.formula === '1d8+3').map((spec) => spec.label)).toEqual(['Claws', 'Bite']);
    expect(specs.some((spec) => spec.formula === '2d20' || spec.formula === '1d100')).toBe(false);
    expect(specs.some((spec) => spec.key.startsWith('["stat0001"'))).toBe(true);
  });

  it('keeps the plugin adapter and projected native card in the same markup and preserves readonly input', () => {
    const sheet = projected(TEMPLATE, FIELDS);
    Object.freeze(sheet.template.layout.blocks);
    const native = sharedSheetTemplate(sheet.template);
    const plugin = renderToStaticMarkup(<StatblockSheet template={TEMPLATE} fields={FIELDS} name="Test" variant="full" />);
    const shared = renderToStaticMarkup(<StatblockSheetCore {...native} fields={sheet.fields} name="Test" variant="full" />);
    const pluginDoc = new DOMParser().parseFromString(plugin, 'text/html');
    const sharedDoc = new DOMParser().parseFromString(shared, 'text/html');
    expect(sharedDoc.body.textContent).toBe(pluginDoc.body.textContent);
    expect([...sharedDoc.querySelectorAll('[class]')].map((element) => element.className).filter(Boolean)).toEqual([...pluginDoc.querySelectorAll('[class]')].map((element) => element.className).filter(Boolean));
    expect(native.template).not.toBe(sheet.template);
    expect(native.template.layout.blocks).not.toBe(sheet.template.layout.blocks);
  });

  it('draws rendered-script children in the native stack without reading code', () => {
    const sheet = projected({ ...TEMPLATE, layout: { maxColumns: 1, blocks: [] } }, FIELDS);
    const wire = { ...sheet.template, layout: { maxColumns: 1 as const, blocks: [{ type: 'rendered-script' as const, id: 'script01', blocks: [{ type: 'stat' as const, id: 'read0001', field: 'bonus', look: 'run-in' as const }] }] } };
    const native = sharedSheetTemplate(wire);
    const seen: Array<{ key: string; formula: string }> = [];
    const html = renderToStaticMarkup(<StatblockSheetCore {...native} fields={sheet.fields} name="Test" variant="full" host={collectingHost(seen)} />);
    expect(html).toContain('atlas-sb-stack');
    expect(html).not.toContain('rendered-script');
    expect(seen).toEqual(sheetRollSpecs(native.template, sheet.fields, { scriptReads: native.scriptReads }).map(({ key, formula }) => ({ key, formula })));
    const empty = sharedSheetTemplate({ ...wire, layout: { ...wire.layout, blocks: [{ type: 'rendered-script', id: 'script01', blocks: [] }] } });
    expect(renderToStaticMarkup(<StatblockSheetCore {...empty} fields={sheet.fields} name="Test" variant="full" />)).toContain('Shown by Fantasy Statblocks');
  });

  it('rejects duplicate keys instead of inventing a registry index', () => {
    const duplicate = { ...TEMPLATE, layout: { maxColumns: 1 as const, blocks: [{ type: 'stat' as const, id: 'same0001', field: 'bonus', look: 'run-in' as const }, { type: 'stat' as const, id: 'same0001', field: 'bonus', look: 'run-in' as const }] } };
    expect(() => sheetRollSpecs(duplicate, FIELDS)).toThrow('Duplicate native sheet roll key');
  });
});
