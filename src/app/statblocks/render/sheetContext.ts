import { createContext, useContext } from 'react';
import type { SheetState } from './sheetState';

export interface SheetContextValue {
  state: SheetState;
}

export const SheetContext = createContext<SheetContextValue | null>(null);

/** The statblock a block is rendered for. Blocks render only inside `StatblockSheet`. */
export function useSheet(): SheetContextValue {
  const sheet = useContext(SheetContext);
  if (!sheet) throw new Error('A statblock block was rendered outside StatblockSheet.');
  return sheet;
}
