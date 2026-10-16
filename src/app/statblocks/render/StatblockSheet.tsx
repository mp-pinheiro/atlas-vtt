import React, { useMemo } from 'react';
import type { App } from 'obsidian';
import type { TokenVitals } from '../../services/statblockVitalsSync';
import type { Lookups } from '../expressions/filters';
import type { StatblockTemplate } from '../model/templateTypes';
import type { FieldRecord } from '../values/fieldValues';
import { valueText } from '../values/valueText';
import { readerFor } from '../values/fieldValues';
import { useStatblockDiceRolling } from './shared/useStatblockDiceRolling';
import { StatblockSheetCore } from './StatblockSheetCore';
import { pluginSheetHost } from './pluginSheetHost';
import { scriptReads } from '../model/scriptReads';
import type { SheetMode, SheetVariant, StatblockTokenContext } from './sheetTypes';
import type { TokenRollContext } from '../../types/diceRollOrigin';
import '../../react/components/statblock/statblock.scss';
import './statblock-sheet.scss';


export interface StatblockSheetProps {
  template: StatblockTemplate;
  /** The template's name (a file's basename, a built-in's name); `data-template` and `data-layout` carry its slug. */
  name: string;
  /** The statblock's values: the note's frontmatter. A new object means new values: blocks are worked out again. */
  fields: FieldRecord;
  variant: SheetVariant;
  /** Lookup tables beside the template's own; one of the same name replaces the template's. */
  lookups?: Lookups | undefined;
  /** The token the statblock is shown for: its art, and its resource values in Track blocks. Keep the object while it is unchanged. */
  token?: StatblockTokenContext | undefined;
  /** Every token the statblock stands for, whose hit points its hit dice roll; defaults to `token`. */
  rollTokens?: readonly TokenVitals[] | undefined;
  /** The map view that owns the statblock, where it renders outside one; rolls go to that map. */
  viewId?: string | undefined;
  /** The view, scene and tokens the statblock was opened for; rolls for them name it. */
  originContext?: TokenRollContext | undefined;
  mode?: SheetMode | undefined;
  /** Renders Markdown, resolves images and rolls dice; without it values show as plain text. */
  app?: App | undefined;
  /** The statblock note, which links and images resolve from and rolls are tagged with. */
  sourcePath?: string | undefined;
  /** Shown above the statblock's header, across the card (a note on the template it is drawn with). */
  header?: React.ReactNode;
  /** Shown under the blocks, across the card (the DM screen's token resources). */
  footer?: React.ReactNode;
  /** Empty headed sections folded into chips under the card (`foldRule.ts`); keep the set while it is unchanged. */
  folded?: ReadonlySet<string> | undefined;
  /** A block whose tabs open whenever it or the layout changes (the template editor's selection). */
  reveal?: string | null | undefined;
}

/**
 * A statblock drawn natively from its template: the runtime card. The header
 * Atlas draws for every statblock comes first (`StatblockHeader`). Top-level
 * blocks flow into CSS columns (`columns: <columnWidth>em <maxColumns>`),
 * which take their count from the width the card gets, so it reads as one
 * column in the hover preview and the DM screen and as two in a wide pane.
 * Nothing here measures, and no element is a size container: a container
 * would collapse the hover preview, which takes its width from its content.
 */
export function StatblockSheet({
  template,
  name,
  fields,
  variant,
  lookups,
  token,
  rollTokens,
  viewId,
  originContext,
  mode = 'view',
  app,
  sourcePath,
  header,
  footer,
  folded,
  reveal = null,
}: StatblockSheetProps): React.JSX.Element {
  const host = useMemo(() => pluginSheetHost(app, sourcePath), [app, sourcePath]);
  const reads = useMemo(() => scriptReads(template), [template]);
  const [diceRef, rollMenu] = useStatblockDiceRolling({
    app,
    notePath: sourcePath,
    tokens: rollTokens ?? (token ? [token] : []),
    name: valueText(readerFor(fields, template.fields)('name')) || undefined,
    viewId,
    originContext,
  });

  return <StatblockSheetCore template={template} name={name} fields={fields} variant={variant} host={host} lookups={lookups} token={token} mode={mode} folded={folded} reveal={reveal} scriptReads={reads} header={header} footer={footer} menu={rollMenu} elementRef={diceRef} />;
}
