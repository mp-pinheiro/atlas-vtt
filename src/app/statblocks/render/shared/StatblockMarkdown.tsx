import React, { useContext } from 'react';
import { boundedText } from '../../../creatures/statblockValues';
import { statblockLinksAsText } from '../../values/statblockLinks';
import { SheetRenderHostContext, SheetDiceText, useSheetRollLocation } from '../sheetRenderHost';
import type { SheetValuePath } from './diceSegments';

export interface MarkdownTextProps {
  text: string;
  markdown?: boolean | undefined;
  dice?: boolean | undefined;
  className?: string | undefined;
  valuePath?: SheetValuePath | undefined;
}

export function StatblockMarkdown({ text: given, markdown = true, dice = true, className, valuePath }: MarkdownTextProps): React.JSX.Element {
  const host = useContext(SheetRenderHostContext);
  const location = useSheetRollLocation(valuePath);
  const text = boundedText(given);
  if (markdown && host) return <span className={className}>{host.markdown(text, { key: JSON.stringify([location.blockId, location.valuePath]), inline: true, dice })}</span>;
  const plain = statblockLinksAsText(text);
  return <span className={className}>{dice ? <SheetDiceText text={plain} valuePath={valuePath} /> : plain}</span>;
}
