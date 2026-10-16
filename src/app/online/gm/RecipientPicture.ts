import { FogCoverageCache } from '../../fog/FogCoverageCache';
import type { FogCoverage } from '../../fog/fogCoverage';
import type { MeasurementSettings } from '../../grid/measurementFormat';
import { heldForSight } from '../../lighting/sightOnDrop';
import type { TokenEntity } from '../../types';
import type { Point } from '../../types/visionTypes';
import { doorsInSight, doorMiddle, mapShownAt } from '../../vision/doorSight';
import type { SeenSpot } from '../../vision/perception';
import { NO_SIGHT, SEES_ALL, type Sight } from '../../vision/sight';
import { SceneModelBuilder, SceneSpots, type SceneModel } from '../../vision/sceneModel';
import { selectSight } from '../../vision/selectSight';
import type { SightRules } from '../../vision/sightRules';
import { ownerSightPolicy, type SightPolicy } from '../../vision/tokenSightPolicy';
import { tokenPerception } from '../../vision/tokenPerception';
import type { MapBounds } from '../../vision/visibility';
import { wallList } from '../../vision/wallList';
import type { SceneState } from './atlasView';

export interface RecipientPictureInputs {
  readonly bounds: MapBounds;
  readonly measurement: MeasurementSettings;
  readonly rules: SightRules;
  readonly drawn?: ReadonlyMap<string, Point>;
}

export interface RecipientView {
  readonly state: SceneState;
  readonly rules: SightRules;
  readonly measurement: MeasurementSettings;
  readonly model: SceneModel;
  readonly sight: Sight;
  readonly policy: SightPolicy;
  readonly fog: FogCoverage | null;
  readonly shown: ReadonlySet<string>;
  readonly sensed: ReadonlySet<string>;
  readonly doors: ReadonlySet<string>;
  readonly spots: readonly SeenSpot[];
  readonly drawn: ReadonlyMap<string, Point>;
  readonly sourceIds: ReadonlySet<string>;
  pointsSeen(points: readonly Point[]): boolean[];
}

export class RecipientPicture {
  private readonly builder = new SceneModelBuilder();
  private readonly coverage = new FogCoverageCache();
  private current: { state: SceneState; inputs: RecipientPictureInputs; model: SceneModel } | null = null;

  update(state: SceneState, inputs: RecipientPictureInputs): void {
    if (!state.mapLoaded || state.isMapLoading || state.mapPath === null) {
      this.current = null;
      this.builder.reset();
      return;
    }
    const previous = this.current;
    if (previous?.state.mapPath !== state.mapPath || previous.inputs.bounds.width !== inputs.bounds.width || previous.inputs.bounds.height !== inputs.bounds.height) this.builder.reset();
    try {
      const { model } = this.builder.update(state, inputs.bounds, () => inputs.measurement, () => inputs.rules);
      this.current = { state, inputs, model };
    } catch {
      this.current = null;
      this.builder.reset();
    }
  }

  project(player: string, ownerOf: (token: TokenEntity) => string | undefined): RecipientView | null {
    const current = this.current;
    if (current === null) return null;
    const { state, inputs, model } = current;
    const policy = ownerSightPolicy(player, ownerOf);
    const sourceIds = new Set(Object.values(state.objects.tokens).filter(policy.givesSight).map(token => token.id));
    const sight = !state.lighting.enabled ? SEES_ALL : state.lighting.tokenVision === false ? model.gmSight ?? model.sight : sourceIds.size === 0 ? NO_SIGHT : selectSight(model.gmSight ?? model.sight, state.objects.tokens, policy);
    const fog = this.coverage.get(state.objects.fog, state.mapPath);
    const drawn = inputs.drawn ?? new Map<string, Point>();
    const tokens = Object.fromEntries(Object.entries(state.objects.tokens).map(([id, token]) => {
      const point = drawn.get(id);
      return [id, point === undefined ? token : { ...token, ...point }];
    }));
    const perception = tokenPerception(sight, model.ambient, model.reaches, tokens, { policy, conditions: inputs.rules.conditions, held: heldForSight(state) });
    const shown = new Set<string>();
    const sensed = new Set<string>();
    for (const [id, token] of Object.entries(tokens)) {
      if (fog === null || fog.covers(token)) continue;
      const seen = perception(id);
      if (seen === 'seen') shown.add(id);
      else if (seen === 'sensed') sensed.add(id);
    }
    const sees = mapShownAt(sight, model.ambient, model.reaches);
    const pointsSeen = (points: readonly Point[]): boolean[] => points.map(point => fog !== null && !fog.covers(point) && (!state.lighting.enabled || sees(point)));
    const walls = wallList(state.objects.walls);
    const doors = state.lighting.enabled ? doorsInSight(walls, sight, model.ambient, model.reaches) : new Set<string>();
    for (const wall of walls) if (doors.has(wall.id) && (fog === null || fog.covers(doorMiddle(wall)))) doors.delete(wall.id);
    const spots = new SceneSpots(policy).update(model, state, () => inputs.measurement, () => inputs.rules, sight)
      .filter(spot => fog !== null && !fog.covers(spot));
    return Object.freeze({ state, rules: inputs.rules, measurement: inputs.measurement, model, sight, policy, fog, shown, sensed, doors, spots, drawn, sourceIds, pointsSeen });
  }

  reset(): void {
    this.current = null;
    this.builder.reset();
    this.coverage.reset();
  }
}
