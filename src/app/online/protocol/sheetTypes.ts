import type { StatblockTemplate, TemplateBlock } from '../../statblocks/model/templateTypes.ts';
import type { AssetRef } from './asset.ts';
import type { RollMode } from './chat.ts';

export const MAX_SHEET_BYTES = 1024 * 1024;
export const MAX_SHEET_NODES = 2000;
export const MAX_SHEET_FIELDS = 200;
export const MAX_SHEET_ROLLS = 5000;
export type SheetValue = null | boolean | number | string | readonly SheetValue[] | { readonly [key: string]: SheetValue };
export type SheetReadonly<T> = T extends readonly (infer V)[] ? readonly SheetReadonly<V>[] : T extends object ? { readonly [K in keyof T]: SheetReadonly<T[K]> } : T;
type OrdinaryBlock = Exclude<TemplateBlock, { type: 'section' | 'row' | 'tabs' | 'script' | 'opaque' }>;
type WithoutExtras<T> = T extends unknown ? Omit<T, 'fsExtras'> : never;
type ContainerBase<T extends 'section' | 'row' | 'tabs'> = Omit<Extract<TemplateBlock, { type: T }>, 'blocks' | 'fsExtras'>;
export type SharedSheetBlock =
  | SheetReadonly<WithoutExtras<OrdinaryBlock>>
  | (SheetReadonly<ContainerBase<'section'>> & { readonly blocks: readonly SharedSheetBlock[] })
  | (SheetReadonly<ContainerBase<'row'>> & { readonly blocks: readonly SharedSheetBlock[] })
  | (SheetReadonly<ContainerBase<'tabs'>> & { readonly blocks: readonly SharedSheetBlock[] })
  | { readonly type: 'rendered-script'; readonly id: string; readonly blocks: readonly SharedSheetBlock[] };
export type SharedSheetTemplate = SheetReadonly<Pick<StatblockTemplate, 'format' | 'id' | 'fields' | 'header' | 'lookups' | 'source'>> & {
  readonly version: 1;
  readonly layout: {
    readonly maxColumns: 1 | 2 | 3;
    readonly columnWidth?: number;
    readonly blocks: readonly SharedSheetBlock[];
  };
};
export interface SharedSheet {
  readonly revision: string;
  readonly name: string;
  readonly template: SharedSheetTemplate;
  readonly fields: Readonly<Record<string, SheetValue>>;
  readonly images: Readonly<Record<string, AssetRef>>;
  readonly rolls: readonly { readonly key: string; readonly index: number; readonly formula: string; readonly label: string }[];
}
export type PlayerSheetMessage = { readonly t: 'sheet-roll'; readonly sheet: string; readonly index: number; readonly mode: RollMode };
