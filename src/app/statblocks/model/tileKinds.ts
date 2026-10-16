import { blockSpec } from './blockCatalogue';
import type { TemplateBlock } from './templateTypes';

export type TileKind = 'value' | 'metric' | 'abilities' | 'table' | 'text' | 'divider' | 'other';

export function isAbilityTabs(block: TemplateBlock): boolean {
  return block.type === 'tabs' && block.blocks.length > 0 && block.blocks.every((tab) => tab.type === 'section' && tab.blocks.length === 1 && tab.blocks[0]?.type === 'entries');
}

export function tileKind(block: TemplateBlock): TileKind {
  switch (block.type) {
    case 'stat': case 'tags': case 'pairs': return 'value';
    case 'metric': return 'metric';
    case 'entries': return 'abilities';
    case 'scores': return 'table';
    case 'text': return 'text';
    case 'divider': return 'divider';
    case 'tabs': return isAbilityTabs(block) ? 'abilities' : 'other';
    default: return 'other';
  }
}

const KIND_NAMES: Readonly<Record<Exclude<TileKind, 'other'>, string>> = {
  value: 'Value', metric: 'Metric', abilities: 'Abilities', table: 'Table', text: 'Text', divider: 'Divider',
};

export function kindName(block: TemplateBlock): string {
  const kind = tileKind(block);
  return kind === 'other' ? blockSpec(block.type).label : KIND_NAMES[kind];
}
