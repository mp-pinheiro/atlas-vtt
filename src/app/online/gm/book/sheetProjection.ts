import { boundedValue } from '../../../creatures/statblockValues';
import type { StatblockTemplate, TemplateBlock } from '../../../statblocks/model/templateTypes';
import { sheetState } from '../../../statblocks/render/sheetState';
import { scriptBlocksShown } from '../../../statblocks/render/blockDisplay';
import { parseSharedSheet, type AssetRef, type SharedSheet, type SharedSheetBlock, type SheetValue } from '../../protocol/index';
import { sheetRollSpecs } from '../../../statblocks/render/sheetRollSpecs';
import { scriptReads } from '../../../statblocks/model/scriptReads';
import { sharedSheetTemplate } from '../../../statblocks/render/sharedSheetTemplate';

export interface SheetProjectionInput {
  readonly template: StatblockTemplate;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly revision: string;
  readonly templateId: string;
  image(raw: string): Promise<{ ref: AssetRef; path: string } | null>;
}

export interface SheetProjection {
  readonly sheet: SharedSheet;
  readonly assets: ReadonlyMap<string, string>;
  readonly context?: string;
}

function jsonValue(value: unknown): SheetValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
}

function labels(text: string): string {
  return text.replace(/!?\[\[([^\]]+)\]\]/g, (_match: string, target: string): string => {
    const pieces = target.split('|');
    return pieces[1] ?? (pieces[0] ?? '').split('/').pop() ?? '';
  }).replace(/(?<!!)\[([^\]]*)\]\((?!https?:\/\/)[^)]+\)/g, '$1');
}

export async function projectSheet(input: SheetProjectionInput): Promise<SheetProjection | null> {
  const fields = jsonValue(boundedValue(input.fields)) as Readonly<Record<string, SheetValue>>;
  const state = sheetState({ template: input.template, record: fields, mode: 'view', scriptReads: scriptReads(input.template) });
  const images: Record<string, AssetRef> = {};
  const assets = new Map<string, string>();
  const imageKeys = new Map<string, string>();
  const image = async (raw: string): Promise<string | null> => {
    const previous = imageKeys.get(raw);
    if (previous !== undefined) return previous;
    const resolved = await input.image(raw);
    if (resolved === null) return null;
    const key = `image-${imageKeys.size}`;
    imageKeys.set(raw, key);
    images[key] = resolved.ref;
    assets.set(resolved.ref.hash, resolved.path);
    return key;
  };
  const text = async (value: SheetValue): Promise<SheetValue> => {
    if (typeof value === 'string') {
      let rewritten = value;
      for (const match of value.matchAll(/!\[([^\]]*)\]\(([^)]+)\)|!\[\[([^\]]+)\]\]/g)) {
        const raw = match[2] ?? match[3] ?? '';
        const key = await image(raw);
        rewritten = rewritten.replace(match[0], key === null ? match[1] ?? raw.split('|')[1] ?? '' : `![${match[1] ?? ''}](${key})`);
      }
      return labels(rewritten);
    }
    if (Array.isArray(value)) return Promise.all(value.map(text));
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]): Promise<[string, SheetValue]> => [key, await text(item)])));
  };
  const projected = await text(fields) as Record<string, SheetValue>;
  for (const field of input.template.fields) {
    if (field.type !== 'image') continue;
    const raw = state.reader(field.key);
    if (typeof raw === 'string') projected[field.key] = await image(raw);
  }
  const blocks = (source: readonly TemplateBlock[]): SharedSheetBlock[] => source.flatMap((block): SharedSheetBlock[] => {
    if (block.type === 'opaque') return [];
    if (block.type === 'script') return [{ type: 'rendered-script', id: block.id, blocks: blocks(scriptBlocksShown(block.id, state)) }];
    const { fsExtras: _extras, ...clean } = block;
    if ('blocks' in block) return [{ ...clean, blocks: blocks(block.blocks) } as SharedSheetBlock];
    return [clean as SharedSheetBlock];
  });
  const template = await text(JSON.parse(JSON.stringify({ format: input.template.format, version: 1, id: input.templateId, fields: input.template.fields, header: input.template.header, lookups: input.template.lookups, source: input.template.source, layout: { ...input.template.layout, blocks: blocks(input.template.layout.blocks) } })) as SheetValue);
  const sanitized = parseSharedSheet({ revision: input.revision, name: input.name, template, fields: projected, images, rolls: [] });
  if (sanitized === null) return null;
  const native = sharedSheetTemplate(sanitized.template);
  const rolls = sheetRollSpecs(native.template, sanitized.fields, { scriptReads: native.scriptReads }).map((spec, index) => ({ ...spec, index }));
  const sheet = parseSharedSheet({ ...sanitized, rolls });
  return sheet === null ? null : { sheet, assets };
}
