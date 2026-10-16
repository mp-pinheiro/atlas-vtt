import { readWall } from '../../lighting/lightingObjects';
import { wallList } from '../../vision/wallList';
import { Container } from 'pixi.js';
import type { StoreApi } from 'zustand';
import type { ViewState } from '../../types/viewState';
import type { WallSegment } from '../../types/wallTypes';
import { doorMiddle } from '../../vision/doorSight';
import type { LayerVisibility } from '../playerSafeFrame';
import { destroyTree } from '../utils/destroyTree';
import { createDoorBadgeSet, DoorBadgeRenderer, DoorRefusal, doorBadgeAt, type DoorBadgeSpec, type DoorRefusalLook } from './DoorBadge';

export const DOOR_ICONS_Z_INDEX = 1150;
const NO_DOORS: ReadonlySet<string> = new Set();

export type DoorIconsState = Pick<ViewState, 'grid' | 'lighting' | 'mapPath'> & {
  objects: Pick<ViewState['objects'], 'walls' | 'fog'>;
  toggleDoor(id: string): void;
};

export type DoorIconsStore = Pick<StoreApi<DoorIconsState>, 'getState' | 'subscribe'>;

export function badgeLook(wall: Pick<WallSegment, 'type' | 'locked'>, forPlayers: boolean): { secret: boolean; lock: boolean } {
  return { secret: !forPlayers && wall.type === 'secret-door', lock: !forPlayers && !!wall.locked };
}

export class DoorIcons {
  readonly view = new Container({ label: 'door-icons', zIndex: DOOR_ICONS_Z_INDEX });
  readonly playerView = new Container({ label: 'player-door-icons', zIndex: DOOR_ICONS_Z_INDEX, visible: false });
  private readonly gmBadges = createDoorBadgeSet(this.view);
  private readonly playerBadges = createDoorBadgeSet(this.playerView);
  private readonly renderer = new DoorBadgeRenderer();
  private readonly refusing: DoorRefusal;
  private seen: ReadonlySet<string> = NO_DOORS;
  private readonly unsubscribe: () => void;
  private gmDoors: DoorBadgeSpec[] = [];
  private playerDoors: DoorBadgeSpec[] = [];

  constructor(
    private readonly store: DoorIconsStore,
    canvas: HTMLCanvasElement,
    private readonly playersSee: () => ReadonlySet<string> = () => NO_DOORS,
  ) {
    this.refusing = new DoorRefusal(canvas, () => this.draw(this.store.getState()));
    this.unsubscribe = store.subscribe((state, previous) => {
      if (state.objects.walls !== previous.objects.walls || state.grid !== previous.grid) this.draw(state);
      else if (state.lighting !== previous.lighting || state.objects.fog !== previous.objects.fog || state.mapPath !== previous.mapPath) this.refreshPlayers();
    });
    this.draw(store.getState());
  }

  hitTest(x: number, y: number): string | null {
    if (this.view.visible) return this.gmHitTest(x, y);
    return this.playerView.visible ? doorBadgeAt(this.playerDoors, this.radius(), x, y) : null;
  }

  gmHitTest(x: number, y: number): string | null {
    return this.view.visible ? doorBadgeAt(this.gmDoors, this.radius(), x, y) : null;
  }

  gmLayers(shown: boolean): LayerVisibility[] {
    return [{ layer: this.view, visible: shown }, { layer: this.playerView, visible: false }];
  }

  refreshPlayers(): void {
    const seen = this.playersSee();
    if (seen.size === this.seen.size && [...seen].every((id) => this.seen.has(id))) return;
    this.draw(this.store.getState());
  }

  toggle(wallId: string): void {
    const state = this.store.getState();
    if (!readWall(state.objects.walls[wallId])?.locked) {
      state.toggleDoor(wallId);
      return;
    }
    this.refusing.start(wallId);
  }

  refusal(): DoorRefusalLook | null {
    return this.refusing.look(this.radius());
  }

  private radius(): number {
    return (this.store.getState().grid?.size ?? 70) * 0.2;
  }

  private draw(state: DoorIconsState): void {
    this.seen = this.playersSee();
    this.gmDoors = [];
    this.playerDoors = [];
    for (const wall of wallList(state.objects.walls)) {
      if (wall.type !== 'door' && wall.type !== 'secret-door') continue;
      const centre = doorMiddle(wall);
      const base = { id: wall.id, x: centre.x, y: centre.y, open: !(wall.closed ?? true) };
      this.gmDoors.push({ ...base, ...badgeLook(wall, false) });
      if (this.seen.has(wall.id)) this.playerDoors.push(base);
    }
    const radius = this.radius();
    const refusal = this.refusal();
    this.renderer.draw(this.gmBadges, this.gmDoors, radius, refusal);
    this.renderer.draw(this.playerBadges, this.playerDoors, radius, refusal);
  }

  destroy(): void {
    this.unsubscribe();
    this.refusing.cancel();
    destroyTree(this.view);
    destroyTree(this.playerView);
    this.renderer.destroy();
  }
}
