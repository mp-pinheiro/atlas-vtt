import React from 'react';
import type { PairsBlock } from '../../model/templateTypes';
import { useSheet } from '../sheetContext';
import { LabelledLine } from '../values/LabelledLine';
import { StandIn, ValueText } from '../values/ValueText';
import { ValueSlot } from '../valueSlot';
import type { BlockViewProps } from './blockViewProps';
import { pairsText } from '../values/compoundText';


/** "**Saving Throws** Dex +5, Con +3". */
export function PairsView({ block, display }: BlockViewProps<PairsBlock>): React.JSX.Element {
  const { state } = useSheet();
  const label = block.label ?? state.fields.get(block.field)?.label ?? block.field;
  const signed = block.display === 'signed';
  const value = display.state === 'value' ? state.reader(block.field) : undefined;
  const text = pairsText(value, signed);

  return (
    <LabelledLine label={label} className="atlas-sb-pairs">
      <ValueSlot block={block}>{display.state === 'value' ? <ValueText shown={{ text, problems: [] }} /> : <StandIn display={display} />}</ValueSlot>
    </LabelledLine>
  );
}
