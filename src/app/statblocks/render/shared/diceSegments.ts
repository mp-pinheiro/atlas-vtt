import { t } from '../../../i18n';

const DIE = String.raw`\d*d\d+(?:!!?(?:\d+|i(?![a-z]))|!!)?(?:k[hl]\d*(?![a-z]))?`;
const NEXT_TERM = String.raw`\s*(?:\+\s*-|[+\-−–])\s*(?:${DIE}|\d+)`;
export const DICE_PATTERN = new RegExp(String.raw`((?<!\w)${DIE}(?:${NEXT_TERM})*|(?:ATK|Attack)\s*:\s*[+-]\d+|(?<!\w)[+\-−]\d+(?!\s*d\d))`, 'gi');
export type SheetValuePath = readonly (string | number)[];
export interface DiceSegment { text: string; dice: boolean }

export function sheetRollKey(blockId: string, valuePath: SheetValuePath, segmentOrdinal: number): string {
  return JSON.stringify([blockId, valuePath, segmentOrdinal]);
}

export function toRollFormula(text: string): string {
  return text.replace(/\s+/g, '').replace(/^(?:ATK|Attack):/i, '').replace(/[−–]/g, '-').replace(/\+-/g, '-');
}

export function diceLinkProps(matched: string): { className: string; 'data-formula': string; role: string; tabIndex: number; 'aria-label': string } {
  const formula = toRollFormula(matched);
  return { className: 'atlas-dice-link', 'data-formula': formula, role: 'button', tabIndex: 0, 'aria-label': t('dice.rollFormula', { formula }) };
}

export function splitDiceSegments(text: string): DiceSegment[] {
  const segments: DiceSegment[] = [];
  const pattern = new RegExp(DICE_PATTERN.source, DICE_PATTERN.flags);
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), dice: false });
    segments.push({ text: match[0], dice: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), dice: false });
  return segments;
}
