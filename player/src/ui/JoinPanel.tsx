import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, Compass, KeyRound } from 'lucide-react';
import { Button } from '../../../src/app/packages/components/primitives/button.tsx';
import { TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import type { PlayerStatus } from '../state/playerStore.ts';
import { playerText } from '../i18n.ts';

export interface JoinPanelProps {
  readonly table: string | null;
  readonly hasIdentity: boolean;
  readonly notice: string | null;
  readonly status?: PlayerStatus;
  readonly onJoin: (input: { readonly name: string; readonly code?: string }) => void;
  readonly onForgetIdentity: () => void;
  readonly onTableLink: (link: string) => void;
}

export function JoinPanel({ table, hasIdentity, notice, status, onJoin, onForgetIdentity, onTableLink }: JoinPanelProps): ReactElement {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [freshJoin, setFreshJoin] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [link, setLink] = useState('');
  const validTable = table !== null && TABLE_CODE_PATTERN.test(table);
  const pending = attempted && (status === 'joining' || status === 'waiting');
  let linkedTable: string | null = null;
  try {
    const fragment = new URL(link).hash.slice(1);
    const candidate = fragment.startsWith('table=') ? fragment.slice(6) : fragment;
    if (TABLE_CODE_PATTERN.test(candidate)) linkedTable = candidate;
  } catch {
    linkedTable = null;
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!validTable) {
      if (linkedTable !== null) onTableLink(linkedTable);
      return;
    }
    if (name.trim().length === 0 || pending) return;
    setAttempted(true);
    if (hasIdentity && !freshJoin) onJoin({ name: name.trim() });
    else onJoin({ name: name.trim(), ...(code.trim() === '' ? {} : { code: code.trim() }) });
  };
  return <main className="atlas-player__join atlas-player__surface" aria-labelledby="atlas-player-title">
    <header className="atlas-player__join-brand"><Compass aria-hidden="true" /><span>Atlas <small>{playerText('playerView')}</small></span></header>
    <div className="atlas-player__section"><h1 id="atlas-player-title">{playerText('join')}</h1><p className="atlas-player__muted">{playerText(validTable ? 'joinIntro' : 'joinLinkHelp')}</p></div>
    {notice && <p className="atlas-player__notice" role="status">{notice}</p>}
    {hasIdentity && !freshJoin && <p className="atlas-player__returning"><KeyRound aria-hidden="true" />{playerText('returningPlayer')}</p>}
    <form className="atlas-player__list" onSubmit={submit}>
      {!validTable && <label>{playerText('tableLink')}<input className="atlas-player__field" name="tableLink" type="url" autoComplete="off" autoFocus required value={link} onChange={(event) => setLink(event.currentTarget.value)} /></label>}
      {validTable && <label>{playerText('name')}<input className="atlas-player__field" name="name" autoComplete="nickname" autoFocus maxLength={48} required value={name} disabled={pending} onChange={(event) => setName(event.currentTarget.value)} /></label>}
      {(!hasIdentity || freshJoin) && validTable && <label>{playerText('code')}<input className="atlas-player__field atlas-player__join-code" aria-label={playerText('code')} aria-describedby="atlas-player-code-help" name="code" type="password" autoComplete="off" inputMode="numeric" maxLength={6} value={code} disabled={pending} onChange={(event) => setCode(event.currentTarget.value)} /><span id="atlas-player-code-help" className="atlas-player__muted">{playerText('joinCodeHelp')}</span></label>}
      <Button type="submit" className="atlas-player__join-submit" disabled={pending || (validTable ? name.trim().length === 0 : linkedTable === null)}>{playerText(pending ? 'joining' : 'connect')}<ArrowRight aria-hidden="true" /></Button>
      {hasIdentity && <Button type="button" variant="ghost" onClick={() => { onForgetIdentity(); setFreshJoin(true); setAttempted(false); }}>{playerText('freshJoin')}</Button>}
    </form>
  </main>;
}
