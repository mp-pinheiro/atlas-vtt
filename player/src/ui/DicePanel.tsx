import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import type { LogEntry, RollEntry } from '../../../src/app/online/protocol/log.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { ROLL_MODES, type RollMode } from '../../../src/app/online/protocol/chat.ts';
import { Button } from '../../../src/app/packages/components/primitives/button.tsx';
import { DiceTray } from '../../../src/app/react/components/dice/DiceTray.tsx';
import { playerText } from '../i18n.ts';

const RECENT_ROLL_COUNT = 4;

export interface DicePanelProps {
  readonly scene: string | null;
  readonly entries: readonly LogEntry[];
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly send: (message: PlayerMessage) => boolean;
}

export function DicePanel({ scene, entries, gmOnline, busy, send }: DicePanelProps): ReactElement {
  const [formula, setFormula] = useState('');
  const [mode, setMode] = useState<RollMode>('public');
  const [flavor, setFlavor] = useState('');
  const [rejected, setRejected] = useState(false);
  const rolls = useMemo(
    (): readonly RollEntry[] => entries.filter((entry): entry is RollEntry => entry.kind === 'roll').slice(-RECENT_ROLL_COUNT).reverse(),
    [entries],
  );
  const unavailable = !gmOnline || scene === null || busy;

  const roll = (rolled: string): boolean => {
    if (scene === null || unavailable || rolled.trim() === '') return false;
    const accepted = send({
      t: 'roll',
      scene,
      formula: rolled.trim(),
      token: null,
      mode,
      ...(flavor.trim() === '' ? {} : { flavor: flavor.trim() }),
    });
    setRejected(!accepted);
    return accepted;
  };
  const submitFormula = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    roll(formula);
  };

  return <section className="atlas-player__section atlas-player__dice-panel" aria-label={playerText('tabDice')}>
    <div className="atlas-player__dice-tray" aria-disabled={unavailable}>
      <DiceTray onRoll={(rolled) => roll(rolled)} />
    </div>
    <div className="atlas-player__row atlas-player__dice-options">
      <label className="atlas-player__dice-mode">
        <span>{playerText('rollMode')}</span>
        <select className="atlas-player__field" value={mode} onChange={(event) => setMode(event.currentTarget.value as RollMode)} disabled={unavailable}>
          {ROLL_MODES.map((rollMode) => <option key={rollMode} value={rollMode}>{playerText(rollMode)}</option>)}
        </select>
      </label>
      <label className="atlas-player__dice-flavor">
        <span>{playerText('flavor')}</span>
        <input className="atlas-player__field" maxLength={120} value={flavor} onChange={(event) => setFlavor(event.currentTarget.value)} disabled={unavailable} />
      </label>
    </div>
    <form className="atlas-player__dice-form" onSubmit={submitFormula}>
      <label className="atlas-player__dice-formula">
        <span>{playerText('formula')}</span>
        <input className="atlas-player__field" maxLength={100} placeholder="2d20kh1 + 5" value={formula} onChange={(event) => setFormula(event.currentTarget.value)} disabled={unavailable} />
      </label>
      <Button type="submit" variant="outline" className="atlas-player__dice-submit" disabled={unavailable || formula.trim() === ''}>{playerText('roll')}</Button>
    </form>
    {(rejected || unavailable) && <p className="atlas-player__notice" role="status">{playerText(scene === null ? 'noActiveScene' : !gmOnline ? 'gmOffline' : 'busy')}</p>}
    <section className="atlas-player__section atlas-player__dice-recent" aria-label={playerText('recentRolls')}>
      <h3>{playerText('recentRolls')}</h3>
      {rolls.length === 0 ? <p className="atlas-player__empty">{playerText('noRecentRolls')}</p> : <ol className="atlas-player__list atlas-player__dice-results">
        {rolls.map((entry) => <li className="atlas-player__item atlas-player__dice-result" key={entry.id}>
          <div className="atlas-player__dice-result-copy">
            <strong>{entry.name}</strong>
            <span className="atlas-player__dice-result-detail"><code>{entry.roll.formula}</code>{entry.flavor && <span>{entry.flavor}</span>}</span>
          </div>
          <output className="atlas-player__dice-total" aria-label={`${entry.roll.formula}: ${entry.roll.total}`}>{entry.roll.total}</output>
        </li>)}
      </ol>}
    </section>
  </section>;
}
