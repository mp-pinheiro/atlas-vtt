import { SceneModelBuilder, SceneSpots, type SceneState, type SceneModel } from '../../../src/app/vision/sceneModel.ts';
import { NO_SIGHT } from '../../../src/app/vision/sight.ts';
import { exploredShapes } from '../../../src/app/vision/exploredShapes.ts';
import { readLight, readWall, readEmission } from '../../../src/app/lighting/lightingObjects.ts';
import { readSceneLighting } from '../../../src/app/lighting/sceneLightingOptions.ts';
import { resolveMeasurementSettings, type MeasurementSettings } from '../../../src/app/grid/measurementFormat.ts';
import { PLAYER_SIGHT_POLICY, type SightPolicy } from '../../../src/app/vision/tokenSightPolicy.ts';
import type { SightRules } from '../../../src/app/vision/sightRules.ts';
import { parseSenseDefinitions } from '../../../src/app/gameSystems/senseValidation.ts';
import type { TokenEntity } from '../../../src/app/types.ts';
import type { PlayerSceneState } from '../state/playerStore.ts';
import type { SeenSpot } from '../../../src/app/vision/perception.ts';

export interface PlayerModel { model: SceneModel; state: SceneState; spots: SeenSpot[]; rules: SightRules; policy: SightPolicy }
export class PlayerSceneModel {
  private readonly builder = new SceneModelBuilder();
  private readonly always = new Set<string>();
  private readonly policy: SightPolicy = { givesSight: PLAYER_SIGHT_POLICY.givesSight, alwaysSeen: (token) => this.always.has(token.id) || PLAYER_SIGHT_POLICY.alwaysSeen(token) };
  private readonly spots = new SceneSpots(this.policy);
  private last: { scene: PlayerSceneState; width: number; height: number; model: PlayerModel } | null = null;
  build(scene: PlayerSceneState, width: number, height: number): PlayerModel | null {
    if (this.last && this.last.scene.sight === scene.sight && this.last.scene.lighting === scene.lighting && this.last.scene.scene === scene.scene && this.last.width === width && this.last.height === height) return this.last.model;
    const lighting = scene.lighting;
    const sight = scene.sight;
    if (!lighting || !sight) return null;
    this.always.clear();
    const tokens: Record<string, TokenEntity> = {};
    for (const token of sight.tokens) {
      if (token.alwaysSeen) this.always.add(token.id);
      tokens[token.id] = { id: token.id, kind: 'token', name: '', imagePath: '', x: token.x, y: token.y, size: token.size, rotation: token.rotation ?? 0,
        vision: { enabled: token.vision !== undefined, ...(token.vision?.angle === undefined ? {} : { angle: token.vision.angle }) },
        conditions: [...token.effects ?? []], ...(readEmission(token.light) ? { light: readEmission(token.light)! } : {}) } as TokenEntity;
    }
    const walls = Object.fromEntries(lighting.walls.flatMap((wall, index) => {
      const value = readWall({ id: String(index), kind: 'wall', type: wall.door ? 'door' : 'solid', p1: { x: wall.p[0], y: wall.p[1] }, p2: { x: wall.p[2], y: wall.p[3] }, closed: wall.door === 'closed', direction: wall.direction, blocks: wall.blocks, limited: wall.limited });
      return value ? [[value.id, value]] : [];
    }));
    const lights = Object.fromEntries(sight.lights.flatMap((light) => { const value = readLight({ ...light, kind: 'light' }); return value ? [[value.id, value]] : []; }));
    const lightZones = Object.fromEntries(lighting.zones.map((zone, index) => [String(index), { id: String(index), kind: 'light-zone' as const, polygon: Array.from({ length: zone.polygon.length / 2 }, (_, i) => ({ x: zone.polygon[i * 2]!, y: zone.polygon[i * 2 + 1]! })), ambient: zone.ambient, ...(zone.colour ? { ambientColor: zone.colour } : {}) }]));
    const grid = { enabled: true, size: lighting.cellSize, offsetX: 0, offsetY: 0, opacity: 1, unitDistanceOverride: lighting.unitDistance };
    const state: SceneState = { objects: { tokens, walls, lights, lightZones }, grid, lighting: { ...readSceneLighting(sight.lighting), enabled: true }, heldTokens: Object.fromEntries(sight.held.map((held) => [held.id, { x: held.x, y: held.y }])) };
    const definitions = parseSenseDefinitions(lighting.senses);
    if (!definitions || definitions.length !== lighting.senses.length) return null;
    const rules: SightRules = { definitions, conditions: (['blinded', 'invisible', 'airborne', 'undetected'] as const).map((effect) => ({ id: effect, name: effect, color: '#ffffff', effect })), visionOf: (token) => sight.tokens.find((entry) => entry.id === token.id)?.vision ?? { senses: [] } };
    const measurement = (): MeasurementSettings => resolveMeasurementSettings(undefined, grid);
    const { model: built } = this.builder.update(state, { width, height }, measurement, () => rules);
    const closed = sight.blind === true || (scene.scene.personal && sight.lighting.tokenVision !== false && !sight.tokens.some((token) => token.vision));
    const model = closed ? { ...built, sight: NO_SIGHT, explored: null } : built;
    const spots = this.spots.update(model, state, measurement, () => rules);
    const result = { model: { ...model, explored: closed ? null : exploredShapes(model.sight, model.ambient, model.reaches) }, state, spots, rules, policy: this.policy };
    this.last = { scene, width, height, model: result };
    return result;
  }
  reset(): void { this.builder.reset(); this.always.clear(); this.last = null; }
}
