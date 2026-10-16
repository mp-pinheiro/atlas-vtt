import { DICE_TOAST_KNOT_PATHS, DICE_TOAST_KNOT_SYMBOL_ID } from '../../../src/app/react/components/dice/diceToastOrnament.ts';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { SharedRoll } from '../../../src/app/online/protocol/dice.ts';
import type { DiceRollResult } from '../../../src/app/types/diceTypes.ts';
import { DiceStage } from '../../../src/app/react/components/dice3d/DiceStage.tsx';
import { DiceToast } from '../../../src/app/react/components/dice/DiceToast.tsx';
import { sceneFromRolls } from '../../../src/app/dice3d/diceScene.ts';
import { canShowDice, releaseStagePool } from '../../../src/app/dice3d/stagePool.ts';
import { throwStyle } from '../../../src/app/dice3d/diceDisplay.ts';
import type { PlayerRuntime } from './playerRuntime.ts';

function ReceivedRoll({ roll, name, dismiss }: { readonly roll: SharedRoll; readonly name: string | null; readonly dismiss: () => void }): ReactElement {
  const result = useMemo<DiceRollResult>(() => ({ ...roll, rolls: roll.rolls.map((die) => ({ ...die })) }), [roll]);
  const scene = useMemo(() => canShowDice(document) ? sceneFromRolls(result.rolls) : null, [result]);
  const [settled, setSettled] = useState(scene === null);
  useEffect(() => {
    const timeout = window.setTimeout(dismiss, 12_000);
    return () => window.clearTimeout(timeout);
  }, [dismiss]);
  return <div className="atlas-player__roll">
    {scene !== null && <DiceStage className="atlas-player__dice-stage" scene={scene} crit={result.crit ?? null} onSettled={() => setSettled(true)} muted style={throwStyle('full')} frame={null} seed={result.id} label={result.formula} />}
    {settled && <DiceToast result={result} presentation={{ name, avatar: null }} phase="visible" onDismiss={dismiss} useAvatar={() => null} />}
  </div>;
}

export function AuthoritativeDice({ runtime }: { readonly runtime: PlayerRuntime }): ReactElement {
  const [rolls, setRolls] = useState<readonly { readonly roll: SharedRoll; readonly name: string | null }[]>([]);
  useEffect(() => runtime.subscribe((message) => {
    if (message.t !== 'roll') return;
    const name = runtime.store.getState().scene?.tokens?.tokens.find((token) => token.id === message.token)?.name ?? null;
    setRolls((previous) => [...previous.filter((entry) => entry.roll.id !== message.result.id), { roll: message.result, name }].slice(-3));
  }), [runtime]);
  useEffect(() => {
    const release = (): void => releaseStagePool(document);
    window.addEventListener('pagehide', release);
    return () => { window.removeEventListener('pagehide', release); release(); };
  }, []);
  return <section className="atlas-player__dice-overlay" aria-live="polite"><svg width="0" height="0" aria-hidden="true"><defs><g id={DICE_TOAST_KNOT_SYMBOL_ID} fill="none" stroke="currentColor" strokeWidth="10">{DICE_TOAST_KNOT_PATHS.map((path, index) => <path key={index} d={path} />)}</g></defs></svg>{rolls.map(({ roll, name }) => <ReceivedRoll key={roll.id} roll={roll} name={name} dismiss={() => setRolls((previous) => previous.filter((entry) => entry.roll.id !== roll.id))} />)}</section>;
}
