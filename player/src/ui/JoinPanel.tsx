import { useState, type FormEvent, type ReactElement } from 'react';
import { TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { playerText } from '../i18n.ts';

export interface JoinPanelProps {
  readonly table: string | null;
  readonly hasIdentity: boolean;
  readonly notice: string | null;
  readonly onJoin: (input: { readonly name: string; readonly code?: string }) => void;
  readonly onForgetIdentity: () => void;
  readonly onTableLink: (link: string) => void;
}

export function JoinPanel({ table, hasIdentity, notice, onJoin, onForgetIdentity, onTableLink }: JoinPanelProps): ReactElement {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [freshJoin, setFreshJoin] = useState(false);
  const [link, setLink] = useState('');
  const validTable = table !== null && TABLE_CODE_PATTERN.test(table);
  const linkedTable = (): string | null => {
    try {
      const fragment = new URL(link).hash.slice(1);
      const candidate = fragment.startsWith('table=') ? fragment.slice(6) : fragment;
      return TABLE_CODE_PATTERN.test(candidate) ? candidate : null;
    } catch {
      return null;
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (name.trim().length === 0) return;
    if (!validTable) {
      const candidate = linkedTable();
      if (candidate !== null) onTableLink(candidate);
      return;
    }
    if (hasIdentity && !freshJoin) onJoin({ name: name.trim() });
    else onJoin({ name: name.trim(), ...(code.trim() === '' ? {} : { code: code.trim() }) });
  };
  return <main className="atlas-player__join atlas-player__surface" aria-labelledby="atlas-player-title">
    <h1 id="atlas-player-title">{playerText('title')}</h1>
    {!validTable && <p role="alert">{playerText('invalidTable')}</p>}
    {notice && <p className="atlas-player__notice" role="status">{notice}</p>}
    <form className="atlas-player__list" onSubmit={submit}>
      {!validTable && <label>{playerText('tableLink')}<input className="atlas-player__field" name="tableLink" type="url" required value={link} onChange={(event) => setLink(event.currentTarget.value)} /></label>}
      <label>{playerText('name')}<input className="atlas-player__field" name="name" autoComplete="nickname" maxLength={48} required value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
      {(!hasIdentity || freshJoin) && validTable && <label>{playerText('code')}<input className="atlas-player__field" name="code" type="password" autoComplete="off" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.currentTarget.value)} /></label>}
      <button type="submit" disabled={name.trim().length === 0}>{playerText('connect')}</button>
      {hasIdentity && <button type="button" onClick={() => { onForgetIdentity(); setFreshJoin(true); }}>{playerText('forget')}</button>}
    </form>
  </main>;
}
