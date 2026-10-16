import React from 'react';
import type { SpellsBlock } from '../../model/templateTypes';
import { toFieldValue } from '../../values/fieldValueOf';
import { spellEntries } from '../values/compoundText';
import type { SheetValuePath } from '../shared/diceSegments';
import { valueText } from '../../values/valueText';
import { spellGroups, type SpellLine } from '../shared/spellGroups';
import { StatblockMarkdown } from '../shared/StatblockMarkdown';
import { useSheet } from '../sheetContext';
import { SheetHeading } from '../values/SheetHeading';
import { StandIn } from '../values/ValueText';
import { ValueSlot } from '../valueSlot';
import type { BlockViewProps } from './blockViewProps';
import { SpellTabs } from './SpellTabs';


function SpellList({ lines, path, indexes }: { lines: readonly SpellLine[]; path: SheetValuePath; indexes: readonly number[] }): React.JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <ul className="atlas-sb-spell-list">
      {lines.map((spell, index) => (
        <li key={`${spell.level ?? ''}-${index}`}>
          {spell.level && <span className="atlas-sb-spell-level">{spell.level}: </span>}
          <StatblockMarkdown text={spell.spells} valuePath={[...path, indexes[index] ?? index]} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Spell lists grouped under their header lines, each line led by its level;
 * with the tabs look, a group's levels are tabs under its loose lines.
 */
export function SpellsView({ block, display }: BlockViewProps<SpellsBlock>): React.JSX.Element {
  const { state } = useSheet()
  const name = valueText(state.reader('name')) || 'The creature';
  const groups = display.state === 'value'
    ? spellGroups(spellEntries(state.reader(block.field)), `${name} knows the following spells:`, (value) => valueText(toFieldValue(value)))
    : [];
  const tabbed = block.look === 'tabs';

  return (
    <div className="atlas-sb-spells-block">
      {block.heading?.trim() && <SheetHeading>{block.heading}</SheetHeading>}
      <ValueSlot block={block}>
        {display.state !== 'value' && <StandIn display={display} />}
        {groups.map((group, groupIndex) => {
          const levelled = tabbed ? group.spells.filter((spell) => spell.level !== undefined) : [];
          return (
            <div key={`${group.header}-${groupIndex}`} className="atlas-sb-spell-group">
              <div className="atlas-sb-spell-header">
                <StatblockMarkdown text={group.header} valuePath={[block.field, groupIndex, 'header']} />
              </div>
              <SpellList lines={tabbed ? group.spells.filter((spell) => spell.level === undefined) : group.spells} path={[block.field, groupIndex, 'spells']} indexes={group.spells.flatMap((spell, index) => !tabbed || spell.level === undefined ? [index] : [])} />
              {levelled.length > 0 && <SpellTabs strip={`${block.id}:${groupIndex}`} lines={levelled} path={[block.field, groupIndex, 'spells']} indexes={group.spells.flatMap((spell, index) => spell.level !== undefined ? [index] : [])} />}
            </div>
          );
        })}
      </ValueSlot>
    </div>
  );
}
