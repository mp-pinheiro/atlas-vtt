import type { StatblockTemplate, TemplateBlock } from '../model/templateTypes';
import { shownHeaderParts } from '../model/templateHeader';
import type { FieldRecord } from '../values/fieldValues';
import { toFieldValue } from '../values/fieldValueOf';
import { keyedEntryItems } from '../values/entryKeys';
import { entryExtras, entryName, entryText } from '../values/entryValues';
import { numericValue } from '../values/numberText';
import { valueMisfit } from '../values/valueFit';
import { valueText } from '../values/valueText';
import { blockDisplay, scriptBlocksShown, viewedSheet } from './blockDisplay';
import { sheetState, type SheetState, type SheetStateInput } from './sheetState';
import { sheetRollKey, splitDiceSegments, toRollFormula, type SheetValuePath } from './shared/diceSegments';
import { markdownRollSegments } from './shared/markdownRollSegments';
import { spellGroups } from './shared/spellGroups';
import { metricNumberText } from './values/blockText';
import { pairsText, rollFromDice, spellEntries, tagItems } from './values/compoundText';
import { shownTable } from './values/shownTable';

export interface SheetRollSpec { key: string; formula: string; label: string }

export function sheetRollSpecs(template: StatblockTemplate, fields: FieldRecord, options: Pick<SheetStateInput, 'scriptReads' | 'token' | 'lookups'> = {}): readonly SheetRollSpec[] {
  const result: SheetRollSpec[] = [];
  const keys = new Set<string>();
  const initial = sheetState({ template, record: fields, mode: 'view', ...options });
  const add = (block: TemplateBlock, path: SheetValuePath, text: string, label: string, markdown = true, formula?: string): void => {
    let ordinal = 0;
    const segments = formula ? [{ text: formula, dice: true }] : markdown ? markdownRollSegments(text) : splitDiceSegments(text);
    for (const segment of segments) {
      if (!segment.dice) continue;
      const key = sheetRollKey(block.id, path, ordinal++);
      if (keys.has(key)) throw new Error('Duplicate native sheet roll key');
      keys.add(key);
      result.push({ key, formula: toRollFormula(segment.text), label: label.slice(0, 120) });
      if (result.length > 5000) throw new Error('Native sheet has too many rolls');
    }
  };
  const visit = (block: TemplateBlock, state: SheetState): void => {
    const display = blockDisplay(block, state);
    if (!display) return;
    const path: SheetValuePath = 'field' in block && typeof block.field === 'string' ? [block.field] : [];
    const field = 'field' in block && block.field ? state.fields.get(block.field) : undefined;
    const label = 'label' in block && block.label ? block.label : 'heading' in block && block.heading ? block.heading : field?.label ?? '';
    if (display.state !== 'value') {
      if (display.state === 'fallback') add(block, path, display.text.text, label);
      return;
    }
    switch (block.type) {
      case 'section': case 'row':
        for (const child of block.blocks) visit(child, state);
        return;
      case 'tabs':
        for (const child of block.blocks) if (child.type === 'section') visit(child, state);
        return;
      case 'script':
        for (const child of scriptBlocksShown(block.id, state)) visit(child, viewedSheet(state));
        return;
      case 'title': case 'line': case 'stat': {
        const from = block.type === 'stat' ? rollFromDice(block, state, display) : null;
        if (from && block.type === 'stat') add(block, [block.rollFrom ?? ''], display.text?.text ?? '', label, false, from);
        else if (display.text) add(block, path, display.text.text, label);
        return;
      }
      case 'text':
        add(block, path, block.field ? valueText(state.reader(block.field)) : block.text ?? '', label);
        return;
      case 'metric':
        for (const key of block.fields) if (key) add(block, [key], metricNumberText(key, state).text, state.fields.get(key)?.label ?? key);
        return;
      case 'pairs':
        add(block, path, pairsText(state.reader(block.field), block.display === 'signed'), label);
        return;
      case 'tags': {
        const items = tagItems(state.reader(block.field));
        if (block.look === 'comma') add(block, path, items.join(', '), label);
        else items.forEach((text, index) => add(block, [...path, index], text, label));
        return;
      }
      case 'entries': {
        const shape = field?.entry;
        if (block.introField) add(block, [block.introField], valueText(state.reader(block.introField)), label);
        for (const { item, index } of keyedEntryItems(state.reader(block.field))) {
          const ownLabel = entryName(item, shape) ?? label;
          for (const extra of entryExtras(item, shape)) add(block, [...path, index, extra.key], valueText(extra.value), ownLabel);
          add(block, [...path, index, shape?.textKey ?? 'desc'], entryText(item, shape) ?? '', ownLabel);
        }
        return;
      }
      case 'scores': {
        const shown = shownTable(block, display, state);
        if (!shown) {
          const value = state.reader(block.field);
          if (field && valueMisfit(field, value)) add(block, path, valueText(value), label);
          return;
        }
        const cellLabel = (col: number): string => shown.grid.columns[col]?.name || label;
        if (block.orientation === 'table' && shown.grid.rows.length === 1) {
          shown.grid.columns.forEach((_column, col) => {
            add(block, [...path, 0, col], shown.cells[0]?.[col]?.text ?? '', cellLabel(col));
            shown.derived.forEach((row, index) => add(block, [...path, 'columns', index, col], row.cells[col]?.text ?? '', cellLabel(col)));
          });
        } else {
          shown.cells.forEach((row, r) => row.forEach((cell, col) => add(block, [...path, r, col], cell.text, cellLabel(col))));
          shown.derived.forEach((row, index) => row.cells.forEach((cell, col) => add(block, [...path, 'columns', index, col], cell.text, cellLabel(col))));
        }
        return;
      }
      case 'spells': {
        const name = valueText(state.reader('name')) || 'The creature';
        const groups = spellGroups(spellEntries(state.reader(block.field)), `${name} knows the following spells:`, (value) => valueText(toFieldValue(value)));
        groups.forEach((group, groupIndex) => {
          add(block, [...path, groupIndex, 'header'], group.header, label);
          const ordered = group.spells.map((spell, index) => ({ spell, index }));
          if (block.look === 'tabs') ordered.sort((a, b) => Number(a.spell.level !== undefined) - Number(b.spell.level !== undefined));
          for (const { spell, index } of ordered) add(block, [...path, groupIndex, 'spells', index], spell.spells, label);
        });
        return;
      }
      case 'track': {
        const value = state.reader(block.field);
        const max = numericValue(value);
        const held = block.resource ? state.token?.resources?.[block.resource] : undefined;
        if (!(held && held.max > 0) && !(max !== null && max > 0) && field && valueMisfit(field, value)) add(block, path, valueText(value), label);
        return;
      }
      case 'image': case 'heading': case 'divider': case 'opaque': return;
    }
  };
  for (const part of shownHeaderParts(template)) visit(part.block, initial);
  for (const block of template.layout.blocks) visit(block, initial);
  return result;
}
