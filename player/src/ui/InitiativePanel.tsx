import { useEffect, useState, type ReactElement } from 'react';
import type { SharedCombatant, SharedInitiative } from '../../../src/app/online/protocol/initiative.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { playerText } from '../i18n.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { TokenPortrait } from '../../../src/app/packages/components/shared/TokenPortrait.tsx';

export interface InitiativePanelProps {
  readonly scene: string | null;
  readonly initiative: SharedInitiative | null;
  readonly assets: AssetDownloads;
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly send: (message: PlayerMessage) => boolean;
}
function InitiativeFace({ combatant, assets }: { readonly combatant: SharedCombatant; readonly assets: AssetDownloads }): ReactElement | null {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const art = combatant.art;
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    let acquired = false;
    setImageUrl(null);
    setFailed(false);
    if (art === null) return () => { alive = false; };
    void assets.request(art).then((blob) => {
      if (!alive) { assets.release(art.hash); return; }
      acquired = true;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
      if (acquired) assets.release(art.hash);
    };
  }, [art, assets]);
  if (art === null) return null;
  if (failed) return <span aria-label={playerText('imageUnavailable')} />;
  return <TokenPortrait src={imageUrl ?? ''} alt={combatant.name ?? playerText('hiddenCombatant')} showRing={combatant.ring !== null} ringColor={combatant.ring?.colour ?? undefined} pending={imageUrl === null} />;
}

export function InitiativePanel({ scene, initiative, gmOnline, busy, assets, send }: InitiativePanelProps): ReactElement {
  const mayUseTurnOrder = initiative !== null && !initiative.bySides;
  const endTurnReady = mayUseTurnOrder && initiative?.isActive === true && initiative.turnKey !== null && initiative.turnKey !== undefined;
  return <section className="atlas-player__surface" aria-label={playerText('tabInitiative')}>
    <header className="atlas-player__row"><h2>{playerText('tabInitiative')}</h2>{initiative?.isActive && <span>{playerText('round')} {initiative.round}</span>}</header>
    {initiative === null ? <p>{playerText('noInitiative')}</p> : <div className="atlas-player__list">
      {initiative.combatants.map((combatant) => {
        const mayRoll = scene !== null && gmOnline && !busy && mayUseTurnOrder && combatant.own === true && combatant.rolled === false && combatant.id !== undefined;
        const mayEnd = scene !== null && gmOnline && !busy && endTurnReady && combatant.own === true && combatant.turn && combatant.id !== undefined;
        return <article className="atlas-player__initiative-entry" key={combatant.id ?? `${combatant.side}:${combatant.name}:${combatant.initiative}`}>
          <InitiativeFace combatant={combatant} assets={assets} /><span aria-hidden="true" className={combatant.turn ? 'atlas-player__turn-mark atlas-player__turn-mark--active' : 'atlas-player__turn-mark'} /><strong>{combatant.name ?? playerText('hiddenCombatant')}</strong><span>{combatant.initiative}</span>
          {combatant.sitsOut && <span>{playerText('sitsOut')}</span>}
          {mayRoll && <button type="button" disabled={busy} onClick={() => send({ t: 'initiative-roll', scene: scene as string, combatant: combatant.id as string })}>{playerText('rollInitiative')}</button>}
          {mayEnd && <button type="button" disabled={busy} onClick={() => send({ t: 'end-turn', scene: scene as string, round: initiative.round, combatant: combatant.id as string, turnKey: initiative.turnKey as string })}>{playerText('endTurn')}</button>}
        </article>;
      })}
    </div>}
    {initiative?.bySides && <p>{playerText('initiativeSidesReadOnly')}</p>}
  </section>;
}
