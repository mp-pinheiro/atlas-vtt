import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { CloseButton } from '../../../src/app/packages/components/primitives/CloseButton.tsx';
import { DICE_TOAST_KNOT_PATHS, DICE_TOAST_KNOT_SYMBOL_ID } from '../../../src/app/react/components/dice/diceToastOrnament.ts';
import type { SharedRoll } from '../../../src/app/online/protocol/dice.ts';
import type { DiceRollResult } from '../../../src/app/types/diceTypes.ts';
import { DiceStage } from '../../../src/app/react/components/dice3d/DiceStage.tsx';
import { DiceToast } from '../../../src/app/react/components/dice/DiceToast.tsx';
import { sceneFromRolls } from '../../../src/app/dice3d/diceScene.ts';
import { canShowDice, releaseStagePool } from '../../../src/app/dice3d/stagePool.ts';
import { throwStyle } from '../../../src/app/dice3d/diceDisplay.ts';
import type { PlayerRuntime } from './playerRuntime.ts';
import { playerText } from '../i18n.ts';

const ROLL_DISPLAY_MS = 12_000;
const NARROW_VIEW = '(max-width: 820px)';
interface DisplayedRoll {
  readonly roll: SharedRoll;
  readonly name: string | null;
}

function ReceivedRoll({ roll, name, active, dismiss }: { readonly roll: SharedRoll; readonly name: string | null; readonly active: boolean; readonly dismiss: (id: string) => void }): ReactElement {
  const result = useMemo<DiceRollResult>(() => ({ ...roll, rolls: roll.rolls.map((die) => ({ ...die })) }), [roll]);
  const [scene] = useState(() => active && canShowDice(document) ? sceneFromRolls(result.rolls) : null);
  const [animation, setAnimation] = useState(scene !== null);
  const [settled, setSettled] = useState(scene === null);
  useEffect(() => {
    if (!active) setAnimation(false);
  }, [active]);
  useEffect(() => {
    const timeout = window.setTimeout(() => dismiss(roll.id), ROLL_DISPLAY_MS);
    return () => window.clearTimeout(timeout);
  }, [dismiss, roll.id]);
  const summary = <div className="atlas-player__roll-summary">
    <span className="atlas-player__roll-summary-copy"><strong>{name}</strong><code>{result.formula}</code></span>
    <output className="atlas-player__roll-total" aria-label={`${result.formula}: ${result.total}`}>{result.total}</output>
    <CloseButton className="atlas-player__roll-dismiss" aria-label={playerText('close')} onClick={() => dismiss(roll.id)} />
  </div>;
  if (!active) return <article className="atlas-player__roll atlas-player__roll--compact">{summary}</article>;
  return <article className="atlas-player__roll atlas-player__roll--active">
    {animation && scene !== null && <DiceStage className="atlas-player__dice-stage" scene={scene} crit={result.crit ?? null} onSettled={() => setSettled(true)} muted style={throwStyle('full')} frame={null} seed={result.id} label={result.formula} />}
    {settled || !animation ? <DiceToast result={result} presentation={{ name, avatar: null }} phase="visible" onDismiss={() => dismiss(roll.id)} useAvatar={() => null} /> : summary}
  </article>;
}

export function AuthoritativeDice({ runtime, surface }: { readonly runtime: PlayerRuntime; readonly surface: 'map' | 'tray' | 'log' | 'panel' }): ReactElement {
  const [rolls, setRolls] = useState<readonly DisplayedRoll[]>([]);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_VIEW).matches);
  const compact = narrow && surface !== 'map';
  const dismiss = useCallback((id: string): void => {
    setRolls((previous) => previous.filter((entry) => entry.roll.id !== id));
  }, []);
  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEW);
    const change = (): void => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => runtime.subscribe((message) => {
    if (message.t !== 'roll') return;
    const name = runtime.store.getState().scene?.tokens?.tokens.find((token) => token.id === message.token)?.name ?? null;
    setRolls((previous) => [{ roll: message.result, name }, ...previous.filter((entry) => entry.roll.id !== message.result.id)].slice(0, 3));
  }), [runtime]);
  useEffect(() => {
    const release = (): void => releaseStagePool(document);
    window.addEventListener('pagehide', release);
    return () => { window.removeEventListener('pagehide', release); release(); };
  }, []);
  return <section className="atlas-player__dice-overlay" data-compact={compact} hidden={compact && (surface === 'tray' || surface === 'log')} aria-label={playerText('recentRolls')} aria-live="polite">
    <svg width="0" height="0" aria-hidden="true"><defs><g id={DICE_TOAST_KNOT_SYMBOL_ID} fill="none" stroke="currentColor" strokeWidth="10">{DICE_TOAST_KNOT_PATHS.map((path, index) => <path key={index} d={path} />)}</g></defs></svg>
    {rolls.map(({ roll, name }, index) => <ReceivedRoll key={roll.id} roll={roll} name={name} active={index === 0 && !compact} dismiss={dismiss} />)}
  </section>;
}
