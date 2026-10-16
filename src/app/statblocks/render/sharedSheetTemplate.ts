import type { SharedSheetBlock, SharedSheetTemplate } from '../../online/protocol/sheetTypes';
import type { StatblockTemplate, TemplateBlock, TemplateField } from '../model/templateTypes';
import type { ScriptRead } from './sheetState';

export interface NativeSharedSheet {
  template: StatblockTemplate;
  scriptReads: ReadonlyMap<string, readonly ScriptRead[]>;
  showEmptyScripts: true;
}

function nativeField(field: SharedSheetTemplate['fields'][number]): TemplateField {
  const { formerKeys, options, slots, slotKeys, rows, align, entry, ...base } = field;
  const extras = entry?.extras;
  const entryBase = entry ? { nameKey: entry.nameKey, textKey: entry.textKey } : undefined;
  return {
    ...base,
    ...(formerKeys ? { formerKeys: [...formerKeys] } : {}),
    ...(options ? { options: [...options] } : {}),
    ...(slots ? { slots: [...slots] } : {}),
    ...(slotKeys ? { slotKeys: [...slotKeys] } : {}),
    ...(rows ? { rows: rows.map((row) => [...row]) } : {}),
    ...(align ? { align: [...align] } : {}),
    ...(entryBase ? { entry: {
      ...(entryBase.nameKey !== undefined ? { nameKey: entryBase.nameKey } : {}),
      ...(entryBase.textKey !== undefined ? { textKey: entryBase.textKey } : {}),
      ...(extras ? { extras: extras.map(({ options: choices, ...extra }) => ({ ...extra, ...(choices ? { options: [...choices] } : {}) })) } : {}),
    } } : {}),
  };
}

export function sharedSheetTemplate(shared: SharedSheetTemplate): NativeSharedSheet {
  const reads = new Map<string, readonly ScriptRead[]>();
  const blockOf = (block: SharedSheetBlock): TemplateBlock => {
    switch (block.type) {
      case 'rendered-script': {
        const children = block.blocks.map(blockOf);
        reads.set(block.id, children.map((child) => ({ block: child, shownBy: [] })));
        return { type: 'script', id: block.id, summary: '', fs: {} };
      }
      case 'section': case 'row': case 'tabs': return { ...block, blocks: block.blocks.map(blockOf) };
      case 'line': case 'metric': return { ...block, fields: [...block.fields] };
      case 'scores': {
        const { columns, ...base } = block;
        return { ...base, ...(columns ? { columns: columns.map((column) => ({ ...column })) } : {}) };
      }
      default: return { ...block };
    }
  };
  const { header, source, lookups } = shared;
  const template: StatblockTemplate = {
    format: shared.format,
    version: shared.version,
    id: shared.id,
    fields: shared.fields.map(nativeField),
    layout: { ...shared.layout, blocks: shared.layout.blocks.map(blockOf) },
    ...(header ? { header: { ...(header.hitPoints ? { hitPoints: { ...header.hitPoints } } : {}), ...(header.hidden ? { hidden: [...header.hidden] } : {}) } } : {}),
    ...(source ? { source: { ...source, licences: [...source.licences] } } : {}),
    ...(lookups ? { lookups: Object.fromEntries(Object.entries(lookups).map(([key, values]) => [key, { ...values }])) } : {}),
  };
  return { template, scriptReads: reads, showEmptyScripts: true };
}
