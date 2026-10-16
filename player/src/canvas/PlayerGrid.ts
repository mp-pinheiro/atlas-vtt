import { Container, Graphics } from 'pixi.js';
import { drawSquareGrid } from '../../../src/app/grid/squareGridDrawer.ts';
import { drawHexGrid } from '../../../src/app/grid/hexGridDrawer.ts';
import { createHexLayout } from '../../../src/app/grid/hexGeometry.ts';
import { squareLattice } from '../../../src/app/grid/squareLattice.ts';
import { hexLattice } from '../../../src/app/grid/hexLattice.ts';
import { numberCells } from '../../../src/app/grid/cellNumbering.ts';
import { CellNumberLabels } from '../../../src/app/grid/cellNumberLabels.ts';
import { applyGridMark, createMarkBacking, type GridMarkColor, type UnlitGrid } from '../../../src/app/grid/gridLightingMark.ts';
import { contrastColorForPixels } from '../../../src/app/grid/gridContrastColor.ts';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree.ts';
import type { SharedGrid } from '../../../src/app/online/protocol/mapLayers.ts';
import type { PlayerMap } from './PlayerMap.ts';

export class PlayerGrid implements UnlitGrid {
  readonly container = new Container();
  private readonly lines = new Container();
  private backing: Graphics | null = null;
  private labels: CellNumberLabels | null = null;
  private mark: GridMarkColor | null = null;
  private marked = false;
  private generation = 0;
  private key = '';
  constructor(private readonly changed: () => void) { this.container.addChild(this.lines); }
  update(grid: SharedGrid | null, width: number, height: number, map: PlayerMap | null, zoom: number): void {
    this.labels?.setView({ zoom, pixelRatio: devicePixelRatio });
    const key = JSON.stringify([grid, width, height, map?.key]);
    if (key === this.key) return;
    this.key = key;
    const generation = ++this.generation;
    this.lines.mask = null;
    for (const child of this.lines.removeChildren()) destroyTree(child);
    this.labels = null; this.mark = null;
    if (this.backing) destroyTree(this.backing);
    this.backing = null;
    if (!grid || !map) return;
    const draw = (color: number | null): void => {
      if (generation !== this.generation || color === null) return;
      const graphics = new Graphics();
      const bounds = { minX: 0, minY: 0, maxX: width, maxY: height };
      const layout = grid.type === 'square' ? null : createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
      if (layout) drawHexGrid(graphics, bounds, layout, grid.lineType, grid.lineWidth);
      else drawSquareGrid(graphics, bounds, grid.size, grid.offsetX, grid.offsetY, grid.lineType, grid.lineWidth);
      if (grid.lineType === 'dotted') graphics.fill({ color, alpha: grid.alpha });
      else graphics.stroke({ color, alpha: grid.alpha, width: grid.lineWidth });
      const mask = new Graphics().rect(0, 0, width, height).fill(0xffffff);
      this.lines.addChild(graphics, mask); this.lines.mask = mask;
      if (grid.numbers) {
        this.labels = new CellNumberLabels(numberCells(layout ? hexLattice(layout) : squareLattice(grid.size, grid.offsetX, grid.offsetY), { x: 0, y: 0, width, height }, grid.numbers.format), grid.size, { x: 0, y: 0 }, { color, opacity: grid.numbers.opacity }, { zoom, pixelRatio: devicePixelRatio });
        this.lines.addChild(this.labels.container);
      }
      this.backing = createMarkBacking(0, 0, width, height);
      this.container.addChildAt(this.backing, 0);
      this.mark = { color, contrasting: grid.colour === null };
      this.setMarking(this.marked);
      this.changed();
    };
    if (grid.colour) draw(Number.parseInt(grid.colour.slice(1), 16));
    else void contrastColorForPixels(map).then(draw);
  }
  setMarking(on: boolean): void { this.marked = on; if (this.backing) applyGridMark(this.lines, this.backing, on); }
  markColor(): GridMarkColor | null { return this.mark; }
  destroy(): void { ++this.generation; this.lines.mask = null; destroyTree(this.container); }
}
