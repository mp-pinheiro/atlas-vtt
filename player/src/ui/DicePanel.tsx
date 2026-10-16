import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import type { LogEntry, RollEntry } from '../../../src/app/online/protocol/log.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { ROLL_MODES, type RollMode } from '../../../src/app/online/protocol/chat.ts';
import { playerText } from '../i18n.ts';

export interface DicePanelProps {
  readonly scene: string | null;
  readonly entries: readonly LogEntry[];
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly send: (message: PlayerMessage) => boolean;
}

export function DicePanel({ scene, entries, gmOnline, busy, send }: DicePanelProps): ReactElement {
  const [formula, setFormula] = useState('1d20');
  const [mode, setMode] = useState<RollMode>('public');
  const [flavor, setFlavor] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const rolls = useMemo(() => entries.filter((entry): entry is RollEntry => entry.kind === 'roll').slice(-8).reverse(), [entries]);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (scene === null || !gmOnline || busy || formula.trim() === '') return;
    const message = { t: 'roll', scene, formula: formula.trim(), token: null, mode, ...(flavor.trim() === '' ? {} : { flavor: flavor.trim() }) } as const;
    if (send(message)) setNotice(null);
    else setNotice(playerText('busy'));
  };
  return <section className="atlas-player__surface" aria-label={playerText('tabDice')}>
    <h2>{playerText('tabDice')}</h2>
    <form className="atlas-player__list" onSubmit={submit}>
      <label>{playerText('formula')}<input className="atlas-player__field" maxLength={100} value={formula} onChange={(event) => setFormula(event.currentTarget.value)} disabled={!gmOnline || scene === null || busy} /></label>
      <label>{playerText('rollMode')}<select className="atlas-player__field" value={mode} onChange={(event) => setMode(event.currentTarget.value as RollMode)} disabled={!gmOnline || scene === null || busy}>{ROLL_MODES.map((rollMode) => <option key={rollMode} value={rollMode}>{playerText(rollMode)}</option>)}</select></label>
      <label>{playerText('flavor')}<input className="atlas-player__field" maxLength={120} value={flavor} onChange={(event) => setFlavor(event.currentTarget.value)} disabled={!gmOnline || scene === null || busy} /></label>
      <button type="submit" disabled={!gmOnline || scene === null || busy || formula.trim() === ''}>{playerText('roll')}</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    <div className="atlas-player__list" aria-label={playerText('recentRolls')}>
      {rolls.map((entry) => <article className="atlas-player__item" key={entry.id}>
        <strong>{entry.name}</strong><span>{entry.roll.formula}</span><output>{entry.roll.total}</output>
        {entry.flavor && <p>{entry.flavor}</p>}
      </article>)}
    </div>
  </section>;
}
