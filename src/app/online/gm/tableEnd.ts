import { CLOSE } from '../protocol/index.ts';
export type TableEnd = 'replaced' | 'no-access' | 'superseded' | 'refused';
export type LostTable = Exclude<TableEnd, 'replaced'>;
export function tableEndOf(closeCode: number | null): TableEnd {
  if (closeCode === CLOSE.replaced) return 'replaced';
  if (closeCode === CLOSE.noAccess) return 'no-access';
  if (closeCode === CLOSE.superseded) return 'superseded';
  return 'refused';
}
const END_TEXT: Readonly<Record<TableEnd, string>> = { replaced: 'Another Obsidian took over the online table.', 'no-access': 'The relay refused this table connection.', superseded: 'The online table was closed after a newer table was started.', refused: 'The server closed the online table.' };
export const tableEndText = (end: TableEnd): string => END_TEXT[end];
