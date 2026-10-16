import React from 'react';
import { DiceText } from './DiceText';
import type { SheetValuePath } from './diceSegments';
import { hasInlineMarkup } from './inlineMarkdown';
import { StatblockMarkdown } from './StatblockMarkdown';

export interface InlineTextProps {
  text: string;
  markdown?: boolean | undefined;
  dice: boolean;
  valuePath?: SheetValuePath | undefined;
}

export function InlineText({ text, markdown = true, dice, valuePath }: InlineTextProps): React.JSX.Element {
  if (!markdown || !hasInlineMarkup(text)) return dice ? <DiceText text={text} valuePath={valuePath} /> : <>{text}</>;
  return <StatblockMarkdown text={text} dice={dice} valuePath={valuePath} />;
}
