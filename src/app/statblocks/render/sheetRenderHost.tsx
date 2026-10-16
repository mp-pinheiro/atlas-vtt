import React, { createContext, useContext } from 'react';
import { diceLinkProps, sheetRollKey, splitDiceSegments, type SheetValuePath } from './shared/diceSegments';

export interface SheetRenderHost {
  markdown(text: string, context: { key: string; inline: boolean; dice?: boolean }): React.ReactNode;
  image(key: string): string | null;
  link(label: string, href: string | null): React.ReactNode;
  roll(key: string, text: string, formula?: string): React.ReactNode;
  imageRing?(key: string): boolean | undefined;
}
export interface SheetRollLocation { blockId: string; valuePath: SheetValuePath }
export const SheetRenderHostContext = createContext<SheetRenderHost | null>(null);
export const SheetRollLocationContext = createContext<SheetRollLocation>({ blockId: '', valuePath: [] });

export function useSheetRollLocation(valuePath?: SheetValuePath): SheetRollLocation {
  const location = useContext(SheetRollLocationContext);
  return valuePath ? { blockId: location.blockId, valuePath } : location;
}

export function SheetDiceText({ text, valuePath }: { text: string; valuePath?: SheetValuePath | undefined }): React.JSX.Element {
  const host = useContext(SheetRenderHostContext);
  const location = useSheetRollLocation(valuePath);
  let ordinal = 0;
  return <>{splitDiceSegments(text).map((segment, index) => {
    if (!segment.dice) return <React.Fragment key={index}>{segment.text}</React.Fragment>;
    const key = sheetRollKey(location.blockId, location.valuePath, ordinal++);
    return <React.Fragment key={index}>{host ? host.roll(key, segment.text) : <span {...diceLinkProps(segment.text)}>{segment.text}</span>}</React.Fragment>;
  })}</>;
}
