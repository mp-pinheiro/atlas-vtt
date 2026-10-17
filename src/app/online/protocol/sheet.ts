import { STATBLOCK_LIMITS } from '../../creatures/statblockValues.ts';
import { REQUEST_ID_PATTERN } from './agency.ts';
import { parseAsset, type AssetRef } from './asset.ts';
import { isRollMode } from './chat.ts';
import { isRecord } from './shape.ts';
import { parseSheetTemplate } from './sheetTemplate.ts';
import { MAX_SHEET_BYTES, MAX_SHEET_ROLLS, type PlayerSheetMessage, type SharedSheet, type SheetValue } from './sheetTypes.ts';

export * from './sheetTypes.ts';

interface ValueBudget {
  values: number;
  characters: number;
}

function readValue(value: unknown, depth: number, budget: ValueBudget): SheetValue | undefined {
  if (--budget.values < 0 || depth > STATBLOCK_LIMITS.depth) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (value.length > STATBLOCK_LIMITS.text || value.length > budget.characters) return undefined;
    budget.characters -= value.length;
    return value;
  }
  if (Array.isArray(value)) {
    if (depth === STATBLOCK_LIMITS.depth || value.length > STATBLOCK_LIMITS.entries) return undefined;
    const result: SheetValue[] = [];
    for (const item of value) {
      const next = readValue(item, depth + 1, budget);
      if (next === undefined) return undefined;
      result.push(next);
    }
    return result;
  }
  if (!isRecord(value) || depth === STATBLOCK_LIMITS.depth || Object.keys(value).length > STATBLOCK_LIMITS.entries) return undefined;
  const result: Record<string, SheetValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length > STATBLOCK_LIMITS.key || key in Object.prototype || key.length > budget.characters) return undefined;
    budget.characters -= key.length;
    const next = readValue(item, depth + 1, budget);
    if (next === undefined) return undefined;
    result[key] = next;
  }
  return result;
}

export function parseSharedSheet(value: unknown): SharedSheet | null {
  if (!isRecord(value) || typeof value.revision !== 'string' || !REQUEST_ID_PATTERN.test(value.revision)) return null;
  if (typeof value.name !== 'string' || value.name.length > 200 || !isRecord(value.fields)) return null;
  const template = parseSheetTemplate(value.template);
  const fields = readValue(value.fields, 0, { values: STATBLOCK_LIMITS.values, characters: STATBLOCK_LIMITS.characters });
  if (template === null || !isRecord(fields) || !isRecord(value.images) || !Array.isArray(value.rolls) || value.rolls.length > MAX_SHEET_ROLLS) return null;
  if (Object.keys(value.images).length > STATBLOCK_LIMITS.values) return null;
  const images: Record<string, AssetRef> = {};
  for (const [key, image] of Object.entries(value.images)) {
    if (key.length === 0 || key.length > STATBLOCK_LIMITS.key || key in Object.prototype) return null;
    const ref = parseAsset(image);
    if (ref === null || !ref.mime.startsWith('image/')) return null;
    images[key] = ref;
  }
  const rolls: SharedSheet['rolls'][number][] = [];
  const keys = new Set<string>();
  const indexes = new Set<number>();
  for (const item of value.rolls) {
    if (!isRecord(item) || typeof item.key !== 'string' || item.key.length === 0 || item.key.length > STATBLOCK_LIMITS.characters || keys.has(item.key)) return null;
    if (typeof item.index !== 'number' || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= MAX_SHEET_ROLLS || indexes.has(item.index)) return null;
    if (typeof item.formula !== 'string' || item.formula.length > 128 || typeof item.label !== 'string' || item.label.length > 120) return null;
    keys.add(item.key);
    indexes.add(item.index);
    rolls.push({ key: item.key, index: item.index, formula: item.formula, label: item.label });
  }
  const result: SharedSheet = { revision: value.revision, name: value.name, template, fields, images, rolls };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_SHEET_BYTES ? result : null;
}

export function parsePlayerSheet(value: Record<string, unknown>): PlayerSheetMessage | null {
  if (value.t !== 'sheet-roll' || typeof value.sheet !== 'string' || !REQUEST_ID_PATTERN.test(value.sheet)) return null;
  if (typeof value.index !== 'number' || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= MAX_SHEET_ROLLS || !isRollMode(value.mode)) return null;
  return { t: 'sheet-roll', sheet: value.sheet, index: value.index, mode: value.mode };
}
