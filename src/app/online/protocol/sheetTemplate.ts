import { FIELD_MEANINGS, FIELD_TYPES, HEADER_PART_IDS, TABLE_ALIGNS, type TemplateField } from '../../statblocks/model/templateTypes.ts';
import { isRecord } from './shape.ts';
import { parseSheetBlocks } from './sheetBlocks.ts';
import { MAX_SHEET_FIELDS, type SharedSheetTemplate } from './sheetTypes.ts';
import { wireArray, wireBoolean, wireDictionary, wireEnum, wireNumber, wirePositive, wireShape, wireShapeReader, wireText } from './sheetShape.ts';

const text = wireText(10_000);
const key = wireText(200, true);
const strings = wireArray(text);
const cell = (value: unknown): unknown => value === null || typeof value === 'string' && value.length <= 10_000 ? value : wireNumber(value);
const extra = wireShapeReader({ key, label: text, type: wireEnum('text', 'number', 'list', 'dice', 'choice'), options: strings, several: wireBoolean }, ['key', 'label', 'type']);
const fieldRules = {
  key, label: text, type: wireEnum(...FIELD_TYPES), meaning: wireEnum(...FIELD_MEANINGS), formerKeys: wireArray(key), unit: text,
  options: strings, open: wireBoolean, several: wireBoolean, numbered: wireBoolean, slots: strings, slotKeys: strings, header: wireEnum(false),
  rows: wireArray(wireArray(cell)), align: wireArray((value: unknown): unknown => value === null ? null : wireEnum(...TABLE_ALIGNS)(value)),
  addRows: wireEnum(false), addColumns: wireEnum(false),
  entry: wireShapeReader({ nameKey: key, textKey: key, extras: wireArray(extra) }), prompt: text,
};
const header = wireShapeReader({
  hidden: wireArray(wireEnum(...HEADER_PART_IDS)),
  hitPoints: wireShapeReader({ look: wireEnum('boxes', 'gauge'), counts: wireEnum('down', 'up'), resource: key }, ['look', 'counts']),
});
const source = wireShapeReader({
  system: text, label: text, licences: wireArray(wireEnum('CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'ORC', 'DS-Creator', 'RTG-Homebrew', 'Paizo-CUP'), 16, 1),
  attribution: wireText(1024 * 1024), licenceUrl: text, sourceUrl: text, modification: text, trademarkNotice: text,
}, ['system', 'label', 'licences', 'attribution', 'licenceUrl', 'modification']);
const lookups = wireDictionary(wireDictionary(text, 2000), 2000);

export function parseSheetTemplate(value: unknown): SharedSheetTemplate | null {
  if (!isRecord(value) || !isRecord(value.layout)) return null;
  if (!Array.isArray(value.fields) || value.fields.length > MAX_SHEET_FIELDS) return null;
  const fields: TemplateField[] = [];
  const keys = new Set<string>();
  for (const item of value.fields) {
    const field = wireShape<TemplateField>(item, fieldRules, ['key', 'label', 'type']);
    if (field === undefined || field.key in Object.prototype || keys.has(field.key)) return null;
    keys.add(field.key);
    fields.push(field);
  }
  const blocks = parseSheetBlocks(value.layout.blocks);
  if (blocks === null) return null;
  const layout = wireShape<{ maxColumns: 1 | 2 | 3; columnWidth?: number }>(value.layout, { maxColumns: wireEnum(1, 2, 3), columnWidth: wirePositive }, ['maxColumns']);
  const common = wireShape<Omit<SharedSheetTemplate, 'fields' | 'layout'>>(value, {
    format: wireEnum('atlas-statblock-template'), version: wireEnum(1), id: wireText(128, true), header, lookups, source,
  }, ['format', 'version', 'id']);
  if (common === undefined || layout === undefined) return null;
  return { ...common, fields, layout: { ...layout, blocks } };
}
