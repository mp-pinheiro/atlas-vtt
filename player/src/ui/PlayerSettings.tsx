import type { CSSProperties, ReactElement } from 'react';
import { PLAYER_COLOURS, playerTone } from '../../../src/app/online/protocol/colours.ts';
import type { TablePerson } from '../../../src/app/online/protocol/chat.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { playerText } from '../i18n.ts';

export interface PlayerSettingsProps {
  readonly playerId: string | null;
  readonly people: readonly TablePerson[];
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly send: (message: PlayerMessage) => boolean;
}

export function PlayerSettings({ playerId, people, gmOnline, busy, send }: PlayerSettingsProps): ReactElement {
  const person = people.find((entry) => entry.id === playerId);
  const selected = person?.colour ?? (playerId === null ? -1 : playerTone(playerId));
  const choose = (colour: number): void => {
    if (!gmOnline || busy || !send({ t: 'colour', colour })) return;
  };
  return <section className="atlas-player__surface" aria-label={playerText('tabSettings')}>
    <h2>{playerText('tabSettings')}</h2>
    <p>{playerText('colour')}</p>
    <div className="atlas-player__colour-palette" role="group" aria-label={playerText('colour')}>
      {PLAYER_COLOURS.map((variable, index) => <button type="button" key={variable} className="atlas-player__colour-choice" style={{ '--player-choice': `var(${variable})` } as CSSProperties} aria-label={playerText('colourChoice', { number: index + 1 })} aria-pressed={selected === index} disabled={!gmOnline || busy} onClick={() => choose(index)} />)}
    </div>
    {!gmOnline && <p role="status">{playerText('gmOffline')}</p>}
  </section>;
}
