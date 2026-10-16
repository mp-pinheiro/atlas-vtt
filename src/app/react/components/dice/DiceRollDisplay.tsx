import type { EventEmitter } from 'events';
import React, { useCallback, useMemo } from 'react';
import { useAtlasUI } from '../../root/AtlasUIContext';
import { useDiceDisplay } from '../../hooks/useDiceDisplay';
import { useDiceLook } from '../../hooks/useDiceLook';
import type { DiceRollResult } from '../../../types/diceTypes';
import type { DiceRollOrigin } from '../../../types/diceRollOrigin';
import type { PreparedDiceRoll } from './diceSourcePresentation';
import { canRunMapHotkeys } from '../../../keyboard/mapHotkeys';
import { DiceRolls, type DiceRollSubscription, type DiceRollsEscape } from './DiceRolls';
import { useDiceAvatar } from './useDiceAvatar';

export type { DiceRollSubscription, RollOptions } from './DiceRolls';

/** The rolls of one map view's dice tool, as its event bus announces them; none without a bus. */
function busRolls(bus: EventEmitter | undefined): DiceRollSubscription {
  return (onRoll) => {
    if (!bus) return () => undefined;
    const handler = (result: DiceRollResult, origin?: DiceRollOrigin): void => onRoll(result, { muted: false, origin });
    bus.on('dice-rolled', handler);
    return (): void => { bus.off('dice-rolled', handler); };
  };
}

interface DiceRollDisplayProps {
  /** Explicit source for a display outside its owning Atlas view. */
  eventBus?: EventEmitter;
  /** Element the rolls render into, e.g. in the player window. Defaults to where the component is mounted. */
  container?: HTMLElement;
  /**
   * Decides, when each roll arrives, what of it is shown and who it names, e.g. to leave
   * out who rolled it. `origin` is the token and scene the roll was made for, when known.
   */
  prepare?: (result: DiceRollResult, origin: DiceRollOrigin | undefined) => PreparedDiceRoll;
  /** Throws without sound, where another window already plays it. */
  muted?: boolean;
  /** The rolls to show; by default those of the owning view's dice tool (`eventBus`). */
  subscribe?: DiceRollSubscription;
  /**
   * Plays the result sound of a roll shown as a card. A map's own display
   * leaves that to its `DiceToastObserver`; a display outside a map has none.
   */
  cardSounds?: boolean;
}

/**
 * Every dice roll, at the top centre of the map: thrown as 3D dice, or as a
 * result card when 3D dice are off or the roll holds dice no real body shows.
 * Binds `DiceRolls` to the plugin: its settings, its view's event bus, the vault's portraits and
 * the map's hotkey rules.
 */
export function DiceRollDisplay({ container, prepare, muted = false, eventBus: suppliedBus, subscribe, cardSounds = false }: DiceRollDisplayProps): React.ReactElement | null {
  const { app, view } = useAtlasUI();
  const eventBus = suppliedBus ?? view?.serviceManager?.getEventBus();
  const display = useDiceDisplay(app ?? undefined);
  const look = useDiceLook(app ?? undefined);
  const rolls = useMemo(() => subscribe ?? busRolls(eventBus), [subscribe, eventBus]);
  const stageDoc = container?.ownerDocument ?? view?.containerEl.doc ?? document;

  // Escape dismisses every roll on screen, unless something in front of the map
  // takes it (a modal, the palette, the dashboard) or someone is typing. The
  // player window takes no keyboard input, so only the map view listens.
  const win = view?.containerEl.win ?? window;
  const handles = useCallback((e: KeyboardEvent): boolean => canRunMapHotkeys(e, view?.viewId), [view]);
  const escape = useMemo<DiceRollsEscape | undefined>(() => (container ? undefined : { win, handles }), [container, win, handles]);

  return (
    <DiceRolls
      display={display}
      look={look}
      subscribe={rolls}
      stageDoc={stageDoc}
      container={container}
      prepare={prepare}
      muted={muted}
      cardSounds={cardSounds}
      useAvatar={useDiceAvatar}
      escape={escape}
    />
  );
}
