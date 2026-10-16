import { useSyncExternalStore, type ReactElement } from 'react';
import { t } from '../../../src/app/i18n';
import { TABLE_CODE_PATTERN } from '../../../src/app/online/protocol';
import './Root.scss';

/** The table code a join link carries after its `#`; null where the link has none, or one that is no table's. */
export function tableCodeFromHash(hash: string): string | null {
  const code = hash.startsWith('#') ? hash.slice(1) : hash;
  return TABLE_CODE_PATTERN.test(code) ? code : null;
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = (): string => window.location.hash;

/** The page: for now it only says which table the link opens, or what link to open. */
export function Root(): ReactElement {
  const code = tableCodeFromHash(useSyncExternalStore(subscribeToHash, readHash));
  return (
    <main className="atlas-vtt-plugin atlas-player-root">
      <h1>{t('playerApp.title')}</h1>
      {code === null ? (
        <p>{t('playerApp.codeMissing')}</p>
      ) : (
        <p>
          {t('playerApp.tableCode')} <code>{code}</code>
        </p>
      )}
    </main>
  );
}
