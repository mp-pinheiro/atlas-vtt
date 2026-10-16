import { Color, type Application, type Container } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneStore } from '../atlasView';
import type { PendingPaths } from '../PendingPaths';
import { playerTone, PLAYER_COLOURS } from '../../protocol/index';
import { requestRender } from '../../../pixi/RenderScheduler';
import { PendingPathOverlay } from './PendingPathOverlay';

export interface PendingPathRenderer {
  getAppInstance(): Application;
  getViewportInstance(): Viewport | null;
  getCanvasElement(): HTMLCanvasElement;
  addDmWorldOverlay(layer: Container): () => void;
}

export function bindPendingPathSurface(renderer: PendingPathRenderer, store: SceneStore, paths: PendingPaths, colourOf?: (player: string) => number | undefined): () => void {
  const viewport = renderer.getViewportInstance();
  if (viewport === null) throw new Error('The map viewport is unavailable');
  const app = renderer.getAppInstance();
  const canvas = renderer.getCanvasElement();
  const win = canvas.ownerDocument.defaultView;
  if (win === null) throw new Error('The map window is unavailable');
  let paused = false;
  const overlay = new PendingPathOverlay(paths, {
    window: win,
    worldPoint: event => {
      const rect = canvas.getBoundingClientRect();
      return viewport.toWorld((event.clientX - rect.left) * app.screen.width / rect.width, (event.clientY - rect.top) * app.screen.height / rect.height);
    },
    zoom: () => viewport.scale.x,
    colour: path => new Color(win.getComputedStyle(canvas).getPropertyValue(PLAYER_COLOURS[playerTone(path.from, colourOf?.(path.from))]!).trim()).toNumber(),
    gesture: active => {
      if (active && !paused) { paused = true; viewport.plugins.pause('drag'); }
      else if (!active && paused) { paused = false; viewport.plugins.resume('drag'); }
    },
    requestRender: () => requestRender(app),
  });
  const detach = renderer.addDmWorldOverlay(overlay.layer);
  let zoom = viewport.scale.x;
  const tones = new Map<string, number>();
  const tick = (): void => {
    let changed = zoom !== viewport.scale.x;
    zoom = viewport.scale.x;
    for (const path of paths.getSnapshot()) {
      const tone = playerTone(path.from, colourOf?.(path.from));
      if (tones.get(path.from) !== tone) { tones.set(path.from, tone); changed = true; }
    }
    if (changed) overlay.refresh();
    if (!overlay.layer.visible && paths.editingRequest !== null) paths.endEdit(false);
  };
  app.ticker.add(tick);
  const unsubscribe = store.subscribe(state => {
    if (!state.mapLoaded || state.isMapLoading) paths.endEdit(false);
  });
  return () => {
    unsubscribe();
    if (!app.stage.destroyed) app.ticker.remove(tick);
    detach();
    overlay.destroy();
    requestRender(app);
  };
}
