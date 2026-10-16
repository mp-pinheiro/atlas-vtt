import React, { useMemo } from 'react';
import type { App } from 'obsidian';
import { EntryLine as CoreEntryLine, type EntryLineProps } from './EntryLine';
import { SheetRenderHostContext } from '../sheetRenderHost';
import { pluginSheetHost } from '../pluginSheetHost';
import { EditableField } from './EditableField';
import type { StatblockEditPath } from './statblockEditContext';

export function EntryLine({ app, sourcePath, editPaths, ...props }: EntryLineProps & { app?: App | undefined; sourcePath?: string | undefined; editPaths?: { name: StatblockEditPath; text: StatblockEditPath } | undefined }): React.JSX.Element {
  const host = useMemo(() => pluginSheetHost(app, sourcePath), [app, sourcePath]);
  const edit = editPaths ? {
    name: (content: React.ReactNode): React.ReactNode => <EditableField path={editPaths.name} value={props.name ?? ''} editable label="trait name">{content}</EditableField>,
    text: (content: React.ReactNode): React.ReactNode => <EditableField path={editPaths.text} value={props.text} editable label="trait description" multiline>{content}</EditableField>,
  } : undefined;
  return <SheetRenderHostContext.Provider value={host}><CoreEntryLine {...props} edit={edit} /></SheetRenderHostContext.Provider>;
}
