import React, { useId } from 'react';
import type { SpellLine } from '../shared/spellGroups';
import { StatblockMarkdown } from '../shared/StatblockMarkdown';
import type { SheetValuePath } from '../shared/diceSegments';
import { useOpenTab } from '../tabs/openTabs';
import { TabPanel, TabStrip } from '../tabs/TabStrip';

interface SpellTabsProps {
  /** The strip's key among the card's strips: the block and the group. */
  strip: string;
  /** Spell lines that name a level ("1st level (4 slots)"); each is a tab. */
  lines: readonly SpellLine[];
  path: SheetValuePath;
  indexes: readonly number[];
}

/** A group's levelled spell lines as tabs: the level on the tab, its spells in the panel. */
export function SpellTabs({ strip, lines, path, indexes }: SpellTabsProps): React.JSX.Element {
  const idBase = useId();
  const tabs = lines.map((line, index) => ({ id: String(index), label: line.level ?? '' }));
  const [open, choose] = useOpenTab(strip, tabs.map((tab) => tab.id));

  return (
    <div className="atlas-sb-tabs atlas-sb-spell-tabs">
      <TabStrip idBase={idBase} tabs={tabs} selected={open} onSelect={choose} />
      {lines.map((line, index) => (
        <TabPanel key={tabs[index]?.id} idBase={idBase} tab={String(index)} open={String(index) === open}>
          <div className="atlas-sb-spell-panel">
            <StatblockMarkdown text={line.spells} valuePath={[...path, indexes[index] ?? index]} />
          </div>
        </TabPanel>
      ))}
    </div>
  );
}
