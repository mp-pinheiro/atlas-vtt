import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../../utils/cn';
import { throwStyle, type DiceDisplay } from '../../../dice3d/diceDisplay';
import { diceFontClass, type DiceLook } from '../../../dice3d/diceLook';
import { diceSceneToShow } from '../../../dice3d/rollPresentation';
import { warmDiceSounds } from '../../../dice3d/audio/diceSamples';
import { playDiceReveal } from '../../../audio/diceRevealSound';
import { canShowDice, warmStages } from '../../../dice3d/stagePool';
import type { DiceRollResult } from '../../../types/diceTypes';
import type { DiceRollOrigin } from '../../../types/diceRollOrigin';
import type { PreparedDiceRoll, UseDiceAvatar } from './diceSourcePresentation';
import { DiceRollStack } from '../dice3d/DiceRollStack';
import { closeAllRolls, closeRoll, dismissRoll, pushRoll, type StackedRoll } from '../dice3d/rollStackState';
import { DiceToast } from './DiceToast';
import { DICE_TOAST_KNOT_PATHS, DICE_TOAST_KNOT_SYMBOL_ID } from './diceToastOrnament';
import { useDiceToasts } from './useDiceToasts';

/** What comes with a roll to show: `muted` where another display plays its sounds, `origin` the token and scene it was made for. */
export interface RollOptions {
  muted: boolean;
  origin?: DiceRollOrigin | undefined;
}

/** Hands each roll to show to `onRoll`; returns what stops it. */
export type DiceRollSubscription = (onRoll: (result: DiceRollResult, options: RollOptions) => void) => () => void;

/** The key that dismisses every roll on screen: where to listen for it and whether this press is one for the rolls. */
export interface DiceRollsEscape {
  win: Window;
  handles: (event: KeyboardEvent) => boolean;
}

export interface DiceRollsProps {
  /** How rolls are shown: thrown as dice, or as a result card. */
  display: DiceDisplay;
  look: DiceLook;
  /** The rolls to show. Keep it the same function while the source stays the same, or the display subscribes again. */
  subscribe: DiceRollSubscription;
  /** Where the dice stages live: a canvas and its context belong to one document. */
  stageDoc: Document;
  /** Element the rolls render into, e.g. in the player window. Defaults to where the component is mounted. */
  container?: HTMLElement | undefined;
  /**
   * Decides, when each roll arrives, what of it is shown and who it names, e.g. to leave
   * out who rolled it. `origin` is the token and scene the roll was made for, when known.
   */
  prepare?: ((result: DiceRollResult, origin: DiceRollOrigin | undefined) => PreparedDiceRoll) | undefined;
  /** Throws without sound, where another window already plays it. */
  muted?: boolean;
  /**
   * Plays the result sound of a roll shown as a card. A map's own display
   * leaves that to its `DiceToastObserver`; a display outside a map has none.
   */
  cardSounds?: boolean;
  /** Finds a roller's portrait; whoever renders the rolls knows where portraits are kept. It is called as a hook, so keep it the same function. */
  useAvatar: UseDiceAvatar;
  /**
   * Escape dismisses every roll on screen, unless `handles` says something in front of the map
   * takes it or someone is typing. Without it the display takes no keyboard input.
   */
  escape?: DiceRollsEscape | undefined;
}

const CARD_VOLUME = 0.7;

/**
 * Every dice roll, at the top centre of the map: thrown as 3D dice, or as a
 * result card when 3D dice are off or the roll holds dice no real body shows.
 * Presentation only: the plugin's `DiceRollDisplay` and the players' browser client
 * give it their own rolls, settings and portraits.
 */
export function DiceRolls({
  display, look, subscribe, stageDoc, container, prepare, muted = false, cardSounds = false, useAvatar, escape,
}: DiceRollsProps): React.ReactElement | null {
  const { toasts, addToast, dismissToast, dismissAllToasts } = useDiceToasts();
  const [rolls, setRolls] = useState<readonly StackedRoll[]>([]);

  useEffect(() => {
    const show = (raw: DiceRollResult, options: RollOptions): void => {
      const prepared: PreparedDiceRoll = prepare ? prepare(raw, options.origin) : { result: raw };
      const scene = diceSceneToShow(prepared.result, display);
      // Without WebGL a stage stays blank (white on some systems), so the roll shows as a card
      if (!scene || !canShowDice(stageDoc)) {
        addToast(prepared);
        if (cardSounds && !muted && !options.muted) void playDiceReveal(prepared.result.crit ?? null, CARD_VOLUME).catch(() => undefined);
        return;
      }
      if (!muted && !options.muted) warmDiceSounds();
      setRolls((prev) => pushRoll(prev, { ...prepared, scene, style: throwStyle(display), ...(options.muted && { muted: true as const }) }));
    };
    return subscribe(show);
  }, [subscribe, addToast, prepare, display, muted, cardSounds, stageDoc]);

  // Dice stages are built while nothing rolls, so that the first roll does not wait for one.
  useEffect(() => {
    if (display !== 'card') warmStages(stageDoc);
  }, [display, stageDoc]);

  const showing = rolls.some((roll) => !roll.leaving) || toasts.some((toast) => toast.phase !== 'exiting');
  useEffect(() => {
    if (!escape || !showing) return;
    const { win, handles } = escape;
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !handles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setRolls(closeAllRolls);
      dismissAllToasts();
    };
    win.addEventListener('keydown', handler, true);
    return (): void => win.removeEventListener('keydown', handler, true);
  }, [escape, showing, dismissAllToasts]);

  const close = useCallback((id: string): void => setRolls((prev) => closeRoll(prev, id)), []);
  const dismiss = useCallback((id: string): void => setRolls((prev) => dismissRoll(prev, id)), []);

  if (toasts.length === 0 && rolls.length === 0) return null;

  const content = (
    // Carries the plugin class itself: in the player window no ancestor does.
    <div className={cn('atlas-dice-rolls atlas-vtt-plugin', diceFontClass(look))}>
      {toasts.length > 0 && (
        // Knotwork defined once; every toast corner draws it with <use>.
        <svg className="atlas-dice-rolls__defs" aria-hidden="true">
          <defs>
            <g id={DICE_TOAST_KNOT_SYMBOL_ID} fill="none" stroke="currentColor" strokeWidth="10">
              {DICE_TOAST_KNOT_PATHS.map((d, i) => <path key={i} d={d} />)}
            </g>
          </defs>
        </svg>
      )}
      <DiceRollStack rolls={rolls} muted={muted} onClose={close} onDone={dismiss} useAvatar={useAvatar} />
      {toasts.map((toast) => (
        <DiceToast key={toast.id} result={toast.result} presentation={toast.sourcePresentation} phase={toast.phase} onDismiss={() => dismissToast(toast.id)} useAvatar={useAvatar} />
      ))}
    </div>
  );
  return container ? createPortal(content, container) : content;
}
