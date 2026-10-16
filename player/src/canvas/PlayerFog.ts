import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { FogCoverageCache } from '../../../src/app/fog/FogCoverageCache.ts';
import { FogCanvasCompositor } from '../../../src/app/pixi/fog/FogCanvasCompositor.ts';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree.ts';
import type { FogCoverage } from '../../../src/app/fog/fogCoverage.ts';
import type { FogOperation } from '../../../src/app/types/fogTypes.ts';
import type { SharedFog } from '../../../src/app/online/protocol/fog.ts';

export class PlayerFog {
  readonly container = new Container();
  private readonly cache = new FogCoverageCache();
  private readonly cover = new Graphics();
  private compositor: FogCanvasCompositor | null = null;
  private sprite: Sprite | null = null;
  private coverage: FogCoverage | null = null;
  private last: SharedFog | undefined;
  private geometry = '';
  constructor() { this.container.addChild(this.cover); }
  update(fog: SharedFog, width: number, height: number, scene: string): void {
    const geometry = JSON.stringify([scene, width, height]);
    if (this.last === fog && this.geometry === geometry) return;
    this.last = fog;
    this.cover.clear().rect(0, 0, width, height).fill(0x000000);
    this.cover.visible = true;
    if (geometry !== this.geometry) {
      this.geometry = geometry;
      this.sprite?.texture.destroy(true);
      if (this.sprite) destroyTree(this.sprite);
      this.compositor?.destroy();
      this.cache.reset();
      this.compositor = new FogCanvasCompositor({ x: 0, y: 0, width, height }, Math.min(1, 4096 / Math.max(width, height)), this.cache, () => scene);
      this.sprite = new Sprite(Texture.from(this.compositor.getCanvas()));
      this.sprite.width = width; this.sprite.height = height;
      this.container.addChildAt(this.sprite, 0);
    }
    this.coverage = null;
    if (fog === null) return;
    const operations: Record<string, FogOperation> = {};
    fog.forEach((operation, index) => {
      const base = { id: String(index), kind: 'fog' as const, timestamp: index, isErasing: operation.erase };
      operations[String(index)] = operation.type === 'rectangle' ? { ...base, type: 'rectangle', x: operation.x, y: operation.y, width: operation.width, height: operation.height } : { ...base, type: operation.type, points: Array.from({ length: operation.points.length / 2 }, (_, i) => ({ x: operation.points[i * 2]!, y: operation.points[i * 2 + 1]! })), ...(operation.type === 'brush' ? { brushRadius: operation.radius } : {}) } as FogOperation;
    });
    this.coverage = this.cache.get(operations, scene);
    this.cover.visible = !this.compositor!.composite(operations);
    this.sprite!.texture.source.update();
  }
  visible(point: { x: number; y: number }): boolean { return this.coverage !== null && !this.coverage.covers(point); }
  destroy(): void { this.sprite?.texture.destroy(true); this.compositor?.destroy(); destroyTree(this.container); }
}
