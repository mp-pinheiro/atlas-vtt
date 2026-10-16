import type { ReactElement } from 'react';
import { playerText } from '../i18n.ts';

export interface SourceFooterProps {
  readonly revision: string;
  readonly sourceUrl: string;
  readonly noticesUrl: string;
}

export function SourceFooter({ revision, sourceUrl, noticesUrl }: SourceFooterProps): ReactElement {
  let source: URL | null = null;
  try {
    source = new URL(sourceUrl);
  } catch {
    source = null;
  }
  const allowedSource = source?.protocol === 'https:' && source.username === '' && source.password === '' && revision.length > 0;
  const revisionUrl = allowedSource && source !== null ? source.href : null;
  return <footer className="atlas-player__row atlas-player__source">
    {revisionUrl !== null && <a href={revisionUrl} target="_blank" rel="noopener noreferrer">{playerText('source')} ({revision.slice(0, 8)})</a>}
    <a href="/LICENSE" target="_blank" rel="noopener noreferrer">{playerText('licence')}</a>
    <a href={noticesUrl} target="_blank" rel="noopener noreferrer">{playerText('notices')}</a>
  </footer>;
}
