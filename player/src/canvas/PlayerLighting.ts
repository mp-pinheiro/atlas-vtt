import { Container, Matrix, Texture, type Renderer } from 'pixi.js';
import { LightingEngine } from '../../../src/app/pixi/lighting/engine/LightingEngine.ts';
import { SightMask } from '../../../src/app/pixi/lighting/SightMask.ts';
import { showsMap, perceivedLevel } from '../../../src/app/gameSystems/senseRules.ts';
import type { UnlitGrid } from '../../../src/app/grid/gridLightingMark.ts';
import type { PlayerSceneState } from '../state/playerStore.ts';
import { PlayerSceneModel, type PlayerModel } from './sceneModel.ts';
import { PlayerMemory } from './PlayerMemory.ts';
import type { ExploredStore } from '../state/interfaces.ts';
import { tokenPerception } from '../../../src/app/vision/tokenPerception.ts';
import { heldForSight } from '../../../src/app/lighting/sightOnDrop.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import type { TokenEntity } from '../../../src/app/types.ts';

export class PlayerLighting {
  readonly container = new Container();
  private readonly engine: LightingEngine;
  private readonly fallback = new SightMask();
  private readonly projection = new PlayerSceneModel();
  private readonly memory: PlayerMemory;
  private shared: Texture | null = null;
  private sharedBitmap: ImageBitmap | null = null;
  private generation = 0;
  private current: PlayerModel | null = null;
  constructor(renderer: Renderer, store: ExploredStore, changed: () => void, notice: (message: string) => void) {
    this.engine = new LightingEngine(renderer);
    this.engine.setMode('player');
    this.memory = new PlayerMemory(renderer, store, changed, notice);
    this.container.addChild(this.engine.layer, this.fallback.view);
    if (renderer.name !== 'webgl') this.engine.fail(new Error('Dynamic lighting requires WebGL; using the sight mask.'));
  }
  update(scene: PlayerSceneState, width: number, height: number, albedo: Texture | null, table: string, player: string): boolean {
    if (!scene.scene.lit) { this.engine.setEnabled(false); this.fallback.clear(); return true; }
    const built = this.projection.build(scene, width, height);
    this.current = built;
    if (!built) return false;
    const { model, state, spots } = built;
    const personal = scene.scene.personal === true;
    this.engine.setMode('player');
    this.engine.setEnabled(true);
    const restored = this.engine.takeRestored();
    if (restored) this.memory.close();
    this.engine.update({ ...state.lighting, bounds: { width, height }, albedo, walls: model.walls, lights: model.lights, sight: model.sight, spots, sightRadius: (state.grid?.size ?? 70) / 2, ambient: state.lighting.ambient, zones: model.zones });
    if (!this.engine.failed && this.engine.hasWorld()) {
      this.fallback.clear();
      if (personal && scene.scene.memoryId && scene.scene.map) {
        this.memory.open({ table, player, memoryId: scene.scene.memoryId, mapHash: scene.scene.map.hash, geometry: JSON.stringify([width, height]) }, width, height);
        this.memory.record(model.explored);
        this.engine.setExplored(this.memory.texture);
      } else this.engine.setExplored(this.shared ?? Texture.EMPTY);
      return true;
    }
    if (!this.engine.failed) return false;
    const seeing = model.sight.regions.filter((region) => showsMap(region.sense));
    const footprints = spots.map((spot) => spot.polygon);
    this.fallback.compose({ width, height, shown: model.sight.all ? null : [...seeing.flatMap((region) => region.polygon ? [region.polygon] : []), ...footprints], darkness: model.reaches.filter((reach) => reach.darkness).map((reach) => reach.polygon), pierced: [...seeing.filter((region) => perceivedLevel(region.sense, 'magical-dark') !== null).flatMap((region) => region.polygon ? [region.polygon] : []), ...footprints] });
    return true;
  }
  async setSharedMask(blob: Blob | null): Promise<void> {
    const generation = ++this.generation;
    if (!blob) { this.engine.setExplored(Texture.EMPTY); this.shared?.destroy(true); this.shared = null; this.sharedBitmap?.close(); this.sharedBitmap = null; return; }
    const bitmap = await createImageBitmap(blob);
    if (generation !== this.generation) { bitmap.close(); return; }
    const old = this.shared;
    const oldBitmap = this.sharedBitmap;
    this.sharedBitmap = bitmap;
    this.shared = Texture.from(bitmap);
    this.engine.setExplored(this.shared);
    old?.destroy(true);
    oldBitmap?.close();
  }
  visibility(tokens: readonly SharedToken[]): (token: SharedToken) => boolean {
    const built = this.current;
    if (!built) return () => false;
    const positioned: Record<string, TokenEntity> = {};
    for (const token of tokens) {
      const source = built.state.objects.tokens[token.id];
      if (source) positioned[token.id] = { ...source, x: token.x, y: token.y };
    }
    const perceived = tokenPerception(built.model.sight, this.engine.failed ? { ambient: 1 } : built.model.ambient, built.model.reaches, positioned, { conditions: built.rules.conditions, held: heldForSight(built.state), policy: built.policy });
    return (token): boolean => perceived(token.id) === 'seen';
  }
  setView(matrix: Matrix, zoom: number): void { this.engine.setView(matrix, zoom); }
  setGrid(grid: UnlitGrid | null): void { this.engine.setGrid(grid); }
  tick(now: number): boolean { return this.engine.animate(now); }
  contextLost(): void { this.memory.close(false); }
  reset(): void { ++this.generation; this.current = null; this.projection.reset(); this.memory.close(); this.engine.setEnabled(false); this.fallback.clear(); this.shared?.destroy(true); this.shared = null; this.sharedBitmap?.close(); this.sharedBitmap = null; }
  destroy(): void { this.reset(); this.memory.destroy(); this.engine.destroy(); this.fallback.destroy(); this.container.destroy(); }
}
