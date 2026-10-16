import React from 'react';

import { cn } from '../../../../utils/cn';
import { hitPointsAttribute, namesHitPoints } from './hitPoints';
import { InlineText } from './InlineText';
import { StatblockMarkdown } from './StatblockMarkdown';
import type { SheetValuePath } from './diceSegments';

export interface EntryLineProps {
  name: string | undefined;
  text: string;
  valuePath?: SheetValuePath | undefined;
  markdown?: boolean | undefined;
  /**
   * `run-in`: "Claws" in front of the text, as written, as the native card writes entries;
   * `heading`: the name on a line of its own; unset: the name as Fantasy Statblocks writes it.
   */
  nameStyle?: 'run-in' | 'heading' | undefined;
  edit?: { name(content: React.ReactNode): React.ReactNode; text(content: React.ReactNode): React.ReactNode } | undefined;
  /** Shown between the name and the text: an entry's labelled extras. */
  children?: React.ReactNode;
  /** The entry's identity in its list (`values/entryKeys.ts`) and its place there: what an editor's handles and drags address. */
  itemKey?: string | undefined;
  itemIndex?: number | undefined;
}

/**
 * One entry of a list of traits or actions: its name, then its text. The
 * classes are the ones dice rolls read their ability name from.
 */
export function EntryLine({
  name,
  text,
  valuePath,
  markdown = true,
  nameStyle,
  edit,
  children,
  itemKey,
  itemIndex,
}: EntryLineProps): React.JSX.Element | null {
  if (!name && !text) return null;
  const nameText = name && <InlineText text={nameStyle === 'run-in' ? name.trim() : name} markdown={markdown} dice={false} />;
  const description = <StatblockMarkdown text={text} markdown={markdown} valuePath={valuePath} />;

  return (
    <div
      className={cn('atlas-sb-trait', nameStyle && `atlas-sb-trait--${nameStyle}`)}
      data-item-key={itemKey}
      data-item-index={itemIndex}
      {...hitPointsAttribute(namesHitPoints(name))}
    >
      {name && (
        <span className="atlas-sb-trait-name">
          {edit ? edit.name(nameText) : nameText}
        </span>
      )}
      {children}
      {edit ? edit.text(description) : description}
    </div>
  );
}
