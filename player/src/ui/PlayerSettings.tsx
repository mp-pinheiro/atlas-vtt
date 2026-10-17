import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { PLAYER_COLOURS, playerTone } from '../../../src/app/online/protocol/colours.ts';
import type { TablePerson } from '../../../src/app/online/protocol/chat.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { Button } from '../../../src/app/packages/components/primitives/button.tsx';
import { playerText } from '../i18n.ts';

export type PlayerTheme = 'system' | 'light' | 'dark';

export interface PlayerSettingsProps {
  readonly playerId: string | null;
  readonly people: readonly TablePerson[];
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly send: (message: PlayerMessage) => boolean;
  readonly theme?: PlayerTheme;
  readonly onThemeChange?: (theme: PlayerTheme) => void;
}

export function PlayerSettings({ playerId, people, gmOnline, busy, send, theme, onThemeChange }: PlayerSettingsProps): ReactElement {
  const person = people.find((entry) => entry.id === playerId);
  const selected = person?.colour ?? (playerId === null ? -1 : playerTone(playerId));
  const [localTheme, setLocalTheme] = useState<PlayerTheme>(theme ?? 'system');
  useEffect(() => {
    if (theme !== undefined) setLocalTheme(theme);
  }, [theme]);
  const currentTheme = theme ?? localTheme;

  const choose = (colour: number): void => {
    if (!gmOnline || busy) return;
    send({ t: 'colour', colour });
  };
  const changeTheme = (value: string): void => {
    const nextTheme = value as PlayerTheme;
    setLocalTheme(nextTheme);
    onThemeChange?.(nextTheme);
  };

  return <section className="atlas-player__section atlas-player__settings" aria-label={playerText('tabSettings')}>
    <section className="atlas-player__section atlas-player__settings-group">
      <h3>{playerText('colour')}</h3>
      <div className="atlas-player__colour-palette" role="group" aria-label={playerText('colour')}>
        {PLAYER_COLOURS.map((variable, index) => <Button
          type="button"
          key={variable}
          variant="ghost"
          className="atlas-player__colour-choice"
          style={{ '--player-choice': `var(${variable})` } as CSSProperties}
          aria-label={playerText('colourChoice', { number: index + 1 })}
          aria-pressed={selected === index}
          disabled={!gmOnline || busy}
          onClick={() => choose(index)}
        />)}
      </div>
      {!gmOnline && <p className="atlas-player__muted" role="status">{playerText('gmOffline')}</p>}
    </section>
    <section className="atlas-player__section atlas-player__settings-group">
      <label className="atlas-player__settings-theme">
        <span>{playerText('theme')}</span>
        <select className="atlas-player__field" value={currentTheme} disabled={onThemeChange === undefined} onChange={(event) => changeTheme(event.currentTarget.value)}>
          <option value="system">{playerText('themeSystem')}</option>
          <option value="light">{playerText('themeLight')}</option>
          <option value="dark">{playerText('themeDark')}</option>
        </select>
      </label>
    </section>
  </section>;
}
