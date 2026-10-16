import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playDiceReveal } from '../../../src/app/audio/diceRevealSound';
import { warmDiceSounds } from '../../../src/app/dice3d/audio/diceSamples';
import { DEFAULT_DICE_LOOK } from '../../../src/app/dice3d/diceLook';
import { warmStages } from '../../../src/app/dice3d/stagePool';
import { DiceRolls, type DiceRollsProps, type DiceRollSubscription, type RollOptions } from '../../../src/app/react/components/dice/DiceRolls';
import type { UseDiceAvatar } from '../../../src/app/react/components/dice/diceSourcePresentation';
import type { DiceRollOrigin } from '../../../src/app/types/diceRollOrigin';
import type { DiceRollResult } from '../../../src/app/types/diceTypes';

// jsdom has no WebGL: whether this device can show dice is the test's to decide, and a stage here is a blank canvas.
const device = vi.hoisted(() => ({ canShowDice: true }));
vi.mock('../../../src/app/dice3d/stagePool', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/app/dice3d/stagePool')>(),
  canShowDice: (): boolean => device.canShowDice,
  warmStages: vi.fn(),
  borrowStage: (): { canvas: HTMLCanvasElement; renderer: null } => ({ canvas: createEl('canvas'), renderer: null }),
  returnStage: (): void => undefined,
}));
vi.mock('../../../src/app/dice3d/audio/diceSamples', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/app/dice3d/audio/diceSamples')>(),
  warmDiceSounds: vi.fn(),
}));
vi.mock('../../../src/app/audio/diceRevealSound', () => ({ playDiceReveal: vi.fn(async (): Promise<void> => undefined) }));

beforeEach(() => {
  device.canShowDice = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const useNoAvatar: UseDiceAvatar = () => null;

function rollOf(die: string, value: number, max: number, changes: Partial<DiceRollResult> = {}): DiceRollResult {
  return { id: 'roll', timestamp: 0, formula: `1${die}`, rolls: [{ die, value, max }], modifiers: 0, total: value, ...changes };
}
const d20 = (value = 14, changes: Partial<DiceRollResult> = {}): DiceRollResult => rollOf('d20', value, 20, changes);

/** A source of rolls the test fires by hand. */
function rollSource(): { subscribe: DiceRollSubscription; emit(result: DiceRollResult, options?: RollOptions): void; subscribers(): number } {
  const handlers = new Set<(result: DiceRollResult, options: RollOptions) => void>();
  return {
    subscribe: (onRoll) => {
      handlers.add(onRoll);
      return (): void => { handlers.delete(onRoll); };
    },
    emit: (result, options = { muted: false }) => { act(() => { handlers.forEach((handler) => handler(result, options)); }); },
    subscribers: () => handlers.size,
  };
}

function show(source: ReturnType<typeof rollSource>, props: Partial<DiceRollsProps> = {}): ReturnType<typeof render> {
  return render(
    <DiceRolls display="full" look={DEFAULT_DICE_LOOK} subscribe={source.subscribe} stageDoc={document} useAvatar={useNoAvatar} {...props} />,
  );
}

const cards = (root: ParentNode): number => root.querySelectorAll('.atlas-dice-toast').length;
const panels = (root: ParentNode): number => root.querySelectorAll('.atlas-dice-roll').length;

function pressEscape(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
}

describe('DiceRolls: dice or card', () => {
  it('shows a result card when the display is card, and builds no dice stages', () => {
    const source = rollSource();
    const { container } = show(source, { display: 'card' });
    source.emit(d20(17));
    expect(cards(container)).toBe(1);
    expect(panels(container)).toBe(0);
    expect(container.querySelector('.atlas-dice-toast')?.textContent).toContain('17');
    expect(warmStages).not.toHaveBeenCalled();
  });

  it('shows a result card where this device cannot show dice, whatever the display says', () => {
    device.canShowDice = false;
    const source = rollSource();
    const { container } = show(source, { display: 'full' });
    source.emit(d20());
    expect(cards(container)).toBe(1);
    expect(panels(container)).toBe(0);
  });

  it.each(['full', 'fast'] as const)('throws dice when the display is %s and the device can show them', (display) => {
    const source = rollSource();
    const { container } = show(source, { display });
    source.emit(d20());
    expect(panels(container)).toBe(1);
    expect(cards(container)).toBe(0);
  });

  it('shows a roll that holds a die no real body shows as a card', () => {
    const source = rollSource();
    const { container } = show(source, { display: 'full' });
    source.emit(rollOf('d7', 3, 7));
    expect(cards(container)).toBe(1);
    expect(panels(container)).toBe(0);
  });

  it('keeps both kinds on screen at once and shows nothing before the first roll', () => {
    const source = rollSource();
    const { container } = show(source, { display: 'full' });
    expect(container.firstChild).toBeNull();
    source.emit(d20(9, { id: 'dice' }));
    source.emit(rollOf('d7', 3, 7, { id: 'card' }));
    expect(panels(container)).toBe(1);
    expect(cards(container)).toBe(1);
    expect(container.querySelector('.atlas-dice-rolls')?.classList.contains('atlas-vtt-plugin')).toBe(true);
  });

  it('warms the dice stages in the given document unless every roll is a card', () => {
    const source = rollSource();
    show(source, { display: 'full' });
    expect(warmStages).toHaveBeenCalledWith(document);
    cleanup();
    vi.mocked(warmStages).mockClear();
    show(source, { display: 'card' });
    expect(warmStages).not.toHaveBeenCalled();
  });

  it('sets the dice font class from the look', () => {
    const source = rollSource();
    const { container } = show(source, { display: 'card', look: { colour: 'light', font: 'scifi' } });
    source.emit(d20());
    expect(container.querySelector('.atlas-dice-rolls')?.classList.contains('atlas-dice-font--scifi')).toBe(true);
  });

  it('renders into the container it is given', () => {
    const source = rollSource();
    const host = document.body.createDiv();
    const { container } = show(source, { display: 'card', container: host });
    source.emit(d20());
    expect(cards(container)).toBe(0);
    expect(cards(host)).toBe(1);
    host.remove();
  });
});

describe('DiceRolls: what each roll names', () => {
  it('hands every roll and its origin to prepare, and shows what prepare returns', () => {
    const origin: DiceRollOrigin = { viewId: 'view-1', mapPath: 'maps/a.atlasmap', tokenId: 'wolf' };
    const prepare = vi.fn<NonNullable<DiceRollsProps['prepare']>>((result) => ({ result: { ...result, total: 99 }, sourcePresentation: null }));
    const source = rollSource();
    const { container } = show(source, { display: 'card', prepare });
    source.emit(d20(5), { muted: false, origin });
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[1]).toEqual(origin);
    expect(container.querySelector('.atlas-dice-toast')?.textContent).toContain('99');
  });

  it('asks useAvatar for the portrait of a card with the source the prepared roll names', () => {
    const useAvatar = vi.fn<UseDiceAvatar>(() => null);
    const source = rollSource();
    show(source, { display: 'card', useAvatar });
    source.emit(d20(11, { source: { type: 'statblock', tokenId: 'wolf', tokenName: 'Wolf', abilityName: 'Bite' } }));
    expect(useAvatar).toHaveBeenCalled();
    expect(useAvatar.mock.calls[0]?.[0]).toMatchObject({ tokenName: 'Wolf' });
  });
});

describe('DiceRolls: sounds', () => {
  it('plays the reveal for a card only when asked to, with the roll\'s crit', () => {
    const source = rollSource();
    show(source, { display: 'card' });
    source.emit(d20(20, { crit: 'high' }));
    expect(playDiceReveal).not.toHaveBeenCalled();
    cleanup();
    show(source, { display: 'card', cardSounds: true });
    source.emit(d20(20, { crit: 'high' }));
    source.emit(d20(7, { id: 'plain' }));
    expect(vi.mocked(playDiceReveal).mock.calls.map(([crit]) => crit)).toEqual(['high', null]);
  });

  it('is silent when muted, as a display or by the roll', () => {
    const source = rollSource();
    show(source, { display: 'card', cardSounds: true, muted: true });
    source.emit(d20());
    cleanup();
    show(source, { display: 'card', cardSounds: true });
    source.emit(d20(), { muted: true });
    expect(playDiceReveal).not.toHaveBeenCalled();
  });

  it('warms the dice sounds for a thrown roll unless it is muted', () => {
    const source = rollSource();
    show(source, { display: 'full' });
    source.emit(d20());
    expect(warmDiceSounds).toHaveBeenCalledOnce();
    source.emit(d20(3, { id: 'quiet' }), { muted: true });
    expect(warmDiceSounds).toHaveBeenCalledOnce();
  });
});

describe('DiceRolls: the rolls it follows', () => {
  it('subscribes once, keeps the subscription while its props change and ends it when unmounted', () => {
    const source = rollSource();
    const view = show(source, { display: 'card' });
    expect(source.subscribers()).toBe(1);
    view.rerender(<DiceRolls display="card" look={DEFAULT_DICE_LOOK} subscribe={source.subscribe} stageDoc={document} useAvatar={useNoAvatar} muted />);
    expect(source.subscribers()).toBe(1);
    view.unmount();
    expect(source.subscribers()).toBe(0);
  });

  it('follows another source once it is given one', () => {
    const first = rollSource();
    const second = rollSource();
    const view = show(first, { display: 'card' });
    view.rerender(<DiceRolls display="card" look={DEFAULT_DICE_LOOK} subscribe={second.subscribe} stageDoc={document} useAvatar={useNoAvatar} />);
    expect([first.subscribers(), second.subscribers()]).toEqual([0, 1]);
    first.emit(d20());
    expect(cards(view.container)).toBe(0);
    second.emit(d20());
    expect(cards(view.container)).toBe(1);
  });
});

describe('DiceRolls: the dismiss-all key', () => {
  const handlesEvery = (): boolean => true;

  it('fades every card on Escape and stops the key, where the display was given the key', () => {
    vi.useFakeTimers();
    const source = rollSource();
    const { container } = show(source, { display: 'card', escape: { win: window, handles: handlesEvery } });
    source.emit(d20(4, { id: 'a' }));
    source.emit(d20(6, { id: 'b' }));
    expect(container.querySelectorAll('.atlas-dice-toast--exiting')).toHaveLength(0);

    const event = pressEscape();
    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelectorAll('.atlas-dice-toast--exiting')).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(300); });
    expect(cards(container)).toBe(0);
  });

  it('lets every thrown roll leave on Escape', () => {
    vi.useFakeTimers();
    const source = rollSource();
    const { container } = show(source, { display: 'full', escape: { win: window, handles: handlesEvery } });
    source.emit(d20());
    expect(panels(container)).toBe(1);
    act(() => { vi.advanceTimersByTime(2000); });
    // The ripcord of a roll whose dice never landed pulls only after seconds more.
    expect(panels(container)).toBe(1);

    pressEscape();
    act(() => { vi.advanceTimersByTime(500); });
    expect(panels(container)).toBe(0);
  });

  it('ignores any other key, and an Escape that something in front of the map takes', () => {
    const handles = vi.fn(() => false);
    const source = rollSource();
    const { container } = show(source, { display: 'card', escape: { win: window, handles } });
    source.emit(d20());

    const taken = pressEscape();
    expect(handles).toHaveBeenCalledOnce();
    expect(taken.defaultPrevented).toBe(false);

    const other = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    act(() => { window.dispatchEvent(other); });
    expect(other.defaultPrevented).toBe(false);
    expect(handles).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('.atlas-dice-toast--exiting')).toHaveLength(0);
  });

  it('listens on the window it is given and nowhere else', () => {
    const own = new EventTarget();
    const handles = vi.fn(() => true);
    const source = rollSource();
    const { container } = show(source, { display: 'card', escape: { win: own as unknown as Window, handles } });
    source.emit(d20());

    // Escape in another window is not this display's.
    expect(pressEscape(window).defaultPrevented).toBe(false);
    expect(handles).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.atlas-dice-toast--exiting')).toHaveLength(0);

    expect(pressEscape(own).defaultPrevented).toBe(true);
    expect(container.querySelectorAll('.atlas-dice-toast--exiting')).toHaveLength(1);
  });

  it('takes no keyboard input without it', () => {
    const source = rollSource();
    const { container } = show(source, { display: 'card' });
    source.emit(d20());
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(container.querySelectorAll('.atlas-dice-toast--exiting')).toHaveLength(0);
  });

  it('listens only while a roll is showing, and no longer once unmounted', () => {
    const handles = vi.fn(() => true);
    const source = rollSource();
    const view = show(source, { display: 'card', escape: { win: window, handles } });
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(handles).not.toHaveBeenCalled();

    source.emit(d20());
    view.unmount();
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(handles).not.toHaveBeenCalled();
  });
});
