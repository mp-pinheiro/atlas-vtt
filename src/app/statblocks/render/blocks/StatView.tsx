import React, { useContext } from 'react';
import { diceLinkProps, sheetRollKey } from '../shared/diceSegments';
import type { StatBlock } from '../../model/templateTypes';
import { namesHitPoints } from '../shared/hitPoints';
import { useSheet } from '../sheetContext';
import { LabelledLine } from '../values/LabelledLine';
import { rollFromDice } from '../values/compoundText';
import { SheetRenderHostContext } from '../sheetRenderHost';
import { DisplayText } from '../values/ValueText';
import { ValueSlot } from '../valueSlot';
import type { BlockViewProps } from './blockViewProps';


/** A labelled value: "**Armor Class** 14" run in, or the label over the value in a stat strip. */
export function StatView({ block, display }: BlockViewProps<StatBlock>): React.JSX.Element {
  const { state } = useSheet();
  const host = useContext(SheetRenderHostContext);
  const field = state.fields.get(block.field);
  const label = block.label ?? field?.label ?? block.field;
  const hitPoints = field?.meaning === 'hit-points' || namesHitPoints(block.field, label);
  const dice = rollFromDice(block, state, display);
  const value = <DisplayText display={display} />;

  return (
    <LabelledLine label={label} look={block.look} className="atlas-sb-stat" hitPoints={hitPoints} placeholder={state.provisional !== undefined}>
      <ValueSlot block={block}>{dice ? host ? host.roll(sheetRollKey(block.id, [block.rollFrom ?? ''], 0), display.state === 'value' ? display.text?.text ?? dice : dice, dice) : <span {...diceLinkProps(dice)}>{value}</span> : value}</ValueSlot>
    </LabelledLine>
  );
}
