import type { FieldValue, StatBlock } from '../../model/templateTypes';
import { isEmptyValue } from '../../values/emptyValue';
import { splitListText } from '../../values/listText';
import { formatSigned, numericValue } from '../../values/numberText';
import { normalisePairs } from '../../values/pairValues';
import { valueText } from '../../values/valueText';
import { isDiceNotation } from '../../values/diceNotation';
import type { SheetState } from '../sheetState';
import type { BlockDisplay } from '../blockDisplay';
import { splitDiceSegments } from '../shared/diceSegments';
import { shownField } from './shownText';

export function tagItems(value: FieldValue | undefined): string[] {
  if (value === undefined || isEmptyValue(value)) return [];
  if (Array.isArray(value)) return value.map(valueText).filter((text) => text.trim() !== '');
  return splitListText(valueText(value));
}

export function pairsText(value: FieldValue | undefined, signed: boolean): string {
  const pairs = normalisePairs(value);
  if (!pairs.length) return valueText(value);
  return pairs.map((pair) => {
    const number = signed ? numericValue(pair.value) : null;
    const shown = (number === null ? valueText(pair.value) : formatSigned(number)).trim();
    const name = pair.key.trim().replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
    return [name, shown].filter((part) => part !== '').join(' ');
  }).join(', ');
}

export function spellEntries(value: FieldValue | undefined): FieldValue[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.entries(value).map(([level, spells]): FieldValue => ({ [level]: spells }));
  return [value];
}

export function rollFromDice(block: StatBlock, sheet: SheetState, display: BlockDisplay): string | null {
  if (!block.rollFrom || display.state !== 'value') return null;
  const dice = shownField(block.rollFrom, sheet).text.trim();
  if (!isDiceNotation(dice)) return null;
  return splitDiceSegments(display.text?.text ?? '').some((segment) => segment.dice) ? null : dice;
}
