import { isRecord } from './shape.ts';
import { MAX_SHEET_NODES, type SharedSheetBlock } from './sheetTypes.ts';
import { wireArray, wireEnum, wireNumber, wirePositiveInteger, wireShape, wireShapeReader, wireText, type WireRules } from './sheetShape.ts';

const text = wireText(10_000);
const key = wireText(200);
const display = wireEnum('plain', 'signed');
const condition = (value: unknown): object | undefined => {
  if (!isRecord(value)) return undefined;
  const rules: WireRules = value.is === 'present' || value.is === 'absent'
    ? { field: key, is: wireEnum('present', 'absent') }
    : value.is === 'equal' || value.is === 'not-equal'
      ? { field: key, is: wireEnum('equal', 'not-equal'), value: (item: unknown): unknown => typeof item === 'boolean' || typeof item === 'string' && item.length <= 10_000 ? item : wireNumber(item) }
      : { field: key, is: wireEnum('above', 'below'), value: wireNumber };
  return wireShape(value, rules, value.is === 'present' || value.is === 'absent' ? ['field', 'is'] : ['field', 'is', 'value']);
};
const base: WireRules = { showWhen: condition, whenEmpty: wireEnum('hide', 'fallback', 'fold'), fallback: text, className: wireText(200), size: wireEnum('fit', 'fill') };
const columns = wireArray(wireShapeReader({ label: text, field: key, formula: text, display }));
const bodies: Readonly<Record<SharedSheetBlock['type'], WireRules>> = {
  section: { heading: text, headingField: key, collapsible: wireEnum('open', 'closed') },
  row: { align: wireEnum('start', 'center', 'spread') },
  tabs: { heading: text },
  title: { field: key, level: wireEnum(1, 2, 3), pattern: text },
  line: { fields: wireArray(key), pattern: text, separator: text },
  stat: { field: key, label: text, look: wireEnum('run-in', 'stacked'), pattern: text, display, rollFrom: key },
  metric: { heading: text, fields: wireArray(key, 200, 1) },
  scores: { field: key, orientation: wireEnum('row', 'table'), perLine: wirePositiveInteger, display, columns },
  tags: { field: key, label: text, look: wireEnum('comma', 'chips', 'bullets', 'numbered') },
  text: { field: key, text, heading: text },
  entries: { field: key, heading: text, introField: key, nameStyle: wireEnum('run-in', 'heading'), addLabel: text },
  pairs: { field: key, label: text, display },
  track: { field: key, label: text, resource: key, look: wireEnum('boxes', 'gauge'), counts: wireEnum('down', 'up') },
  image: { field: key, shape: wireEnum('token', 'portrait') },
  spells: { field: key, heading: text, look: wireEnum('lines', 'tabs') },
  heading: { text, level: wireEnum('section', 'minor') },
  divider: {},
  'rendered-script': {},
};
const required: Readonly<Record<SharedSheetBlock['type'], readonly string[]>> = {
  section: ['blocks'], row: ['blocks'], tabs: ['blocks'], title: ['field', 'level'], line: ['fields'], stat: ['field', 'look'],
  metric: ['fields'], scores: ['field', 'orientation'], tags: ['field', 'look'], text: [], entries: ['field'], pairs: ['field'],
  track: ['field', 'look', 'counts'], image: ['field', 'shape'], spells: ['field'], heading: ['text', 'level'], divider: [], 'rendered-script': ['blocks'],
};
const rules: Readonly<Record<string, WireRules>> = Object.fromEntries(Object.entries(bodies).map(([type, body]) => [type, {
  ...(type === 'rendered-script' ? {} : base), ...body, id: wireText(64, true), type: wireEnum(type),
}]));

export function parseSheetBlocks(value: unknown): readonly SharedSheetBlock[] | null {
  const budget = { nodes: 0, ids: new Set<string>() };
  function blocks(items: unknown, depth: number): SharedSheetBlock[] | null {
    if (!Array.isArray(items) || depth > 16 || items.length > MAX_SHEET_NODES) return null;
    const result: SharedSheetBlock[] = [];
    for (const item of items) {
      if (++budget.nodes > MAX_SHEET_NODES || !isRecord(item) || typeof item.type !== 'string' || !Object.hasOwn(bodies, item.type)) return null;
      if (Object.hasOwn(item, 'fsExtras') || Object.hasOwn(item, 'raw') || Object.hasOwn(item, 'fs')) return null;
      const type = item.type as SharedSheetBlock['type'];
      const schema = rules[type];
      if (schema === undefined) return null;
      const parsed = wireShape<{ id: string; type: SharedSheetBlock['type']; blocks?: readonly SharedSheetBlock[] }>(item, schema, ['id', 'type', ...required[type]]);
      if (parsed === undefined || budget.ids.has(parsed.id)) return null;
      budget.ids.add(parsed.id);
      if (type === 'section' || type === 'row' || type === 'tabs' || type === 'rendered-script') {
        const children = blocks(item.blocks, depth + 1);
        if (children === null) return null;
        parsed.blocks = children;
      }
      result.push(parsed as SharedSheetBlock);
    }
    return result;
  }
  return blocks(value, 1);
}
