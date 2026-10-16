import React, { useMemo } from 'react';
import { cn } from '../../../utils/cn';
import { slugify } from '../model/templateIds';
import type { StatblockTemplate } from '../model/templateTypes';
import type { Lookups } from '../expressions/filters';
import type { FieldRecord } from '../values/fieldValues';
import { BlockList } from './BlockView';
import { StatblockHeader } from './StatblockHeader';
import { SheetContext } from './sheetContext';
import { sheetState, type ScriptRead } from './sheetState';
import { SheetRenderHostContext, type SheetRenderHost } from './sheetRenderHost';
import { OpenTabsContext, useOpenTabsState } from './tabs/openTabs';
import type { SheetMode, SheetVariant, StatblockTokenContext } from './sheetTypes';

export interface StatblockSheetCoreProps {
  template: StatblockTemplate;
  name: string;
  fields: FieldRecord;
  variant: SheetVariant;
  host?: SheetRenderHost | undefined;
  lookups?: Lookups | undefined;
  token?: StatblockTokenContext | undefined;
  mode?: SheetMode | undefined;
  folded?: ReadonlySet<string> | undefined;
  scriptReads?: ReadonlyMap<string, readonly ScriptRead[]> | undefined;
  showEmptyScripts?: boolean | undefined;
  reveal?: string | null | undefined;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  menu?: React.ReactNode;
  elementRef?: React.Ref<HTMLDivElement> | undefined;
}

export function StatblockSheetCore({ template, name, fields, variant, host, lookups, token, mode = 'view', folded, scriptReads, showEmptyScripts, reveal = null, header, footer, menu, elementRef }: StatblockSheetCoreProps): React.JSX.Element {
  const state = useMemo(() => sheetState({ template, record: fields, lookups, mode, token, folded, scriptReads, showEmptyScripts }), [template, fields, lookups, mode, token, folded, scriptReads, showEmptyScripts]);
  const sheet = useMemo(() => ({ state }), [state]);
  const openTabs = useOpenTabsState(template.layout, reveal);
  const slug = slugify(name) || undefined;
  const columns = { '--atlas-sb-column-width': `${template.layout.columnWidth ?? 22}em`, '--atlas-sb-max-columns': template.layout.maxColumns } as React.CSSProperties;
  return (
    <SheetRenderHostContext.Provider value={host ?? null}>
      <SheetContext.Provider value={sheet}>
        <OpenTabsContext.Provider value={openTabs}>
          <div ref={elementRef} className={cn('atlas-statblock', 'atlas-sb-sheet', `atlas-sb-sheet--${variant}`, mode === 'editing' && 'is-editing')} data-template={slug} data-layout={slug} data-variant={variant}>
            <div className="atlas-statblock-body">
              {header}
              <StatblockHeader template={template} />
              <div className="atlas-sb-columns" style={columns}><BlockList blocks={template.layout.blocks} /></div>
              {footer}
            </div>
            {menu}
          </div>
        </OpenTabsContext.Provider>
      </SheetContext.Provider>
    </SheetRenderHostContext.Provider>
  );
}
