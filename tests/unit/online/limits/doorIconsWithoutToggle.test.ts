import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { DoorIcons, type DoorIconsState } from '../../../../src/app/pixi/lighting/DoorIcons';
import { DEFAULT_SCENE_LIGHTING } from '../../../../src/app/types/lightingTypes';
import type { WallSegment } from '../../../../src/app/types/wallTypes';
import { stubJsdomGraphics } from '../../../mocks/jsdomGraphics';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

const DOOR = 'door';

/** A closed door from (0, 100) to (100, 100): its badge is at (50, 100). */
const door = (changes: Partial<WallSegment> = {}): WallSegment => ({ id: DOOR, kind: 'wall', type: 'door', p1: { x: 0, y: 100 }, p2: { x: 100, y: 100 }, closed: true, ...changes });

/** Badges over a source as narrow as a client's: the doors and the grid, with or without a way to switch a door. */
function badgesOf(wall: WallSegment, toggleDoor?: DoorIconsState['toggleDoor']): { icons: DoorIcons; walls: () => Record<string, WallSegment> } {
  const restore = stubJsdomGraphics();
  window.matchMedia = (() => ({ matches: false })) as never;
  const store = createStore<DoorIconsState>(() => ({
    grid: null, lighting: { ...DEFAULT_SCENE_LIGHTING }, mapPath: 'maps/doors.atlasmap',
    objects: { walls: { [DOOR]: wall }, fog: {} },
    ...(toggleDoor && { toggleDoor }),
  }));
  const icons = new DoorIcons(store, createEl('canvas'), () => new Set([DOOR]));
  cleanup = () => {
    icons.destroy();
    restore();
  };
  return { icons, walls: () => store.getState().objects.walls };
}

describe('door badges of a view that cannot switch a door', () => {
  it('still draw the badge and answer where it is', () => {
    const { icons } = badgesOf(door());
    expect(icons.view.children.length).toBeGreaterThan(1);
    expect(icons.hitTest(50, 100)).toBe(DOOR);
    expect(icons.hitTest(500, 500)).toBeNull();
  });

  it('do nothing when a badge is pressed', () => {
    const { icons, walls } = badgesOf(door());
    const before = walls();
    expect(() => icons.toggle(DOOR)).not.toThrow();
    expect(walls()).toBe(before);
    expect(walls()[DOOR]?.closed).toBe(true);
    expect(icons.refusal()).toBeNull();
  });

  it('do not shake a locked door\'s badge either: nothing was refused', () => {
    vi.useFakeTimers();
    const { icons } = badgesOf(door({ locked: true }));
    icons.toggle(DOOR);
    vi.advanceTimersByTime(100);
    expect(icons.refusal()).toBeNull();
  });
});

describe('door badges of a view that can', () => {
  it('hand the door to the switch it gave', () => {
    const toggleDoor = vi.fn<(id: string) => void>();
    const { icons } = badgesOf(door(), toggleDoor);
    icons.toggle(DOOR);
    expect(toggleDoor).toHaveBeenCalledTimes(1);
    expect(toggleDoor).toHaveBeenCalledWith(DOOR);
  });

  it('keep a locked door shut and shake its badge instead', () => {
    vi.useFakeTimers();
    const toggleDoor = vi.fn<(id: string) => void>();
    const { icons } = badgesOf(door({ locked: true }), toggleDoor);
    icons.toggle(DOOR);
    vi.advanceTimersByTime(100);
    expect(toggleDoor).not.toHaveBeenCalled();
    expect(icons.refusal()?.doorId).toBe(DOOR);
  });
});
