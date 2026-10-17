import { useEffect, useState, type ReactElement } from 'react';
import type { SharedCombatant, SharedInitiative } from '../../../src/app/online/protocol/initiative.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { Button } from '../../../src/app/packages/components/primitives/button.tsx';
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
  if (failed) return <span className="atlas-player__initiative-face-unavailable" aria-label={playerText('imageUnavailable')} />;
  return <TokenPortrait className="atlas-player__initiative-face" src={imageUrl ?? ''} alt={combatant.name ?? playerText('hiddenCombatant')} showRing={combatant.ring !== null} ringColor={combatant.ring?.colour ?? undefined} pending={imageUrl === null} />;
}

export function InitiativePanel({ scene, initiative, gmOnline, busy, assets, send }: InitiativePanelProps): ReactElement {
  const mayUseTurnOrder = initiative !== null && !initiative.bySides;
  const endTurnReady = mayUseTurnOrder && initiative?.isActive === true && initiative.turnKey !== null && initiative.turnKey !== undefined;
  const canAct = scene !== null && gmOnline && !busy;

  return <section className="atlas-player__section atlas-player__initiative-panel" aria-label={playerText('tabInitiative')}>
    {initiative === null ? <p className="atlas-player__empty">{playerText('noInitiative')}</p> : <>
      {initiative.isActive && <p className="atlas-player__initiative-round">{playerText('round')} {initiative.round}</p>}
      {initiative.combatants.length === 0 ? <p className="atlas-player__empty">{playerText('noCombatants')}</p> : <ol className="atlas-player__list atlas-player__initiative-list">
        {initiative.combatants.map((combatant) => {
          const mayRoll = canAct && mayUseTurnOrder && combatant.own === true && combatant.rolled === false && combatant.id !== undefined;
          const mayEnd = canAct && endTurnReady && combatant.own === true && combatant.turn && combatant.id !== undefined;
          const name = combatant.name ?? playerText('hiddenCombatant');
          return <li className={`atlas-player__item atlas-player__initiative-entry${combatant.turn ? ' atlas-player__initiative-entry--active' : ''}`} key={combatant.id ?? `${combatant.side}:${combatant.name}:${combatant.initiative}`} aria-current={combatant.turn ? 'step' : undefined}>
            <InitiativeFace combatant={combatant} assets={assets} />
            <div className="atlas-player__initiative-person">
              <div className="atlas-player__initiative-name">
                {combatant.turn && <span className="atlas-player__turn-mark" aria-hidden="true" />}
                <strong>{name}</strong>
                {combatant.own && <span className="atlas-player__initiative-own">{playerText('you')}</span>}
              </div>
              {combatant.sitsOut && <span className="atlas-player__muted">{playerText('sitsOut')}</span>}
            </div>
            <output className="atlas-player__initiative-score" aria-label={`${playerText('tabInitiative')}: ${combatant.initiative}`}>{combatant.initiative}</output>
            {(mayRoll || mayEnd) && <div className="atlas-player__initiative-actions" role="group" aria-label={name}>
              {mayRoll && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => send({ t: 'initiative-roll', scene: scene as string, combatant: combatant.id as string })}>{playerText('rollInitiative')}</Button>}
              {mayEnd && <Button type="button" size="sm" disabled={busy} onClick={() => send({ t: 'end-turn', scene: scene as string, round: initiative.round, combatant: combatant.id as string, turnKey: initiative.turnKey as string })}>{playerText('endTurn')}</Button>}
            </div>}
          </li>;
        })}
      </ol>}
      {initiative.bySides && <p className="atlas-player__muted">{playerText('initiativeSidesReadOnly')}</p>}
    </>}
  </section>;
}
