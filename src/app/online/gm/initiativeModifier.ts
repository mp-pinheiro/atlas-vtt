import type { App } from 'obsidian';
import type { InitiativeEntry } from '../../types/initiativeTypes';
import type { InitiativeRules } from '../../types/initiativeRulesTypes';
import type { TokenEntity } from '../../types';
import { readStatblockModifiers } from '../../initiative/statblockModifiers';
import { readStatblockRecord } from '../../statblocks/resolve/statblockRecord';

export async function playerInitiativeModifier(app: App, entry: InitiativeEntry, tokens: Readonly<Record<string, TokenEntity>>, rules: InitiativeRules): Promise<number | null> {
  const { modifiers } = await readStatblockModifiers([entry], tokens, rules, async path => {
    const read = await readStatblockRecord(app, path);
    return read && { fields: read.record, meanings: read.meanings };
  });
  return modifiers.get(entry.id) ?? null;
}
