import React from 'react';
import { SheetDiceText } from '../sheetRenderHost';
import type { SheetValuePath } from './diceSegments';

export function DiceText({ text, valuePath }: { text: string; valuePath?: SheetValuePath | undefined }): React.JSX.Element {
  return <SheetDiceText text={text} valuePath={valuePath} />;
}
