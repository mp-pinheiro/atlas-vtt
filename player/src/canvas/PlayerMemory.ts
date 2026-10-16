import { Texture, type Renderer } from 'pixi.js';
import { ExploredTexture } from '../../../src/app/pixi/lighting/ExploredTexture.ts';
import type { ExploredShapes } from '../../../src/app/vision/exploredShapes.ts';
import type { ExploredMemoryKey, ExploredStore } from '../state/interfaces.ts';
import { playerText } from '../i18n.ts';

export class PlayerMemory {
  private memory: ExploredTexture | null = null;
  private key: ExploredMemoryKey | null = null;
  private writeEpoch: number | null = null;
  private generation = 0;
  private saveGeneration = 0;
  private restoring = false;
  private dirty = false;
  private timer: number | null = null;
  private destroyed = false;
  private lastShapes: ExploredShapes | null = null;
  constructor(private readonly renderer: Renderer, private readonly store: ExploredStore, private readonly changed: () => void, private readonly notice: (message: string) => void) { window.addEventListener('pagehide', this.pagehide); }
  get texture(): Texture { return !this.restoring && this.memory ? this.memory.texture : Texture.EMPTY; }
  open(key: ExploredMemoryKey, width: number, height: number): void {
    if (JSON.stringify(key) === JSON.stringify(this.key)) return;
    this.close();
    this.key = key;
    this.writeEpoch = this.store.writeEpoch(key);
    const memory = this.memory = new ExploredTexture(this.renderer, { width, height });
    const generation = ++this.generation;
    this.restoring = true;
    void this.store.get(key).then(async (blob) => {
      if (!blob || generation !== this.generation) return;
      const url = URL.createObjectURL(blob);
      try {
        const texture = await memory.decode(url);
        if (generation !== this.generation) texture.destroy(true);
        else memory.draw(texture);
      } finally { URL.revokeObjectURL(url); }
    }).catch(() => this.notice(playerText('memoryLost'))).finally(() => {
      if (generation !== this.generation) return;
      this.restoring = false;
      this.changed();
    });
  }
  record(shapes: ExploredShapes | null): void {
    if (!this.memory || this.restoring || !shapes) return;
    if (shapes === this.lastShapes) return;
    this.lastShapes = shapes;
    this.memory.add(shapes);
    this.dirty = true;
    this.changed();
    if (this.timer === null) this.timer = window.setTimeout(() => { this.timer = null; void this.save(); }, 1000);
  }
  private async save(): Promise<void> {
    if (!this.dirty || !this.memory || !this.key || this.restoring || this.writeEpoch === null) return;
    const key = this.key;
    const epoch = this.writeEpoch;
    const generation = this.saveGeneration;
    if (this.store.writeEpoch(key) !== epoch) { this.dirty = false; return; }
    this.dirty = false;
    try {
      const canvas = this.memory.toCanvas();
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Memory PNG encoding failed.')), 'image/png'));
      if (generation !== this.saveGeneration || this.store.writeEpoch(key) !== epoch) return;
      await this.store.put(key, png, epoch);
    } catch {
      if (generation === this.saveGeneration && this.store.writeEpoch(key) === epoch) this.notice(playerText('memoryLost'));
    }
  }
  private readonly pagehide = (): void => { void this.save(); };
  close(save = true): void {
    if (save) void this.save();
    else { ++this.saveGeneration; this.dirty = false; }
    ++this.generation;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.lastShapes = null;
    this.memory?.destroy(); this.memory = null; this.key = null; this.writeEpoch = null; this.restoring = false;
  }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; window.removeEventListener('pagehide', this.pagehide); this.close(); }
}
