import type { Application, Renderer, Texture } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { UnlitGrid } from '../../grid/gridLightingMark';
import type { MeasurementSettings } from '../../grid/measurementFormat';
import type { LightingQualitySource } from '../../lighting/lightingQuality';
import type { SceneStore } from '../../lighting/shownTokens';
import type { SightRules } from '../../vision/sightRules';
import type { MapBounds } from '../../vision/visibility';
import { requestRender } from '../RenderScheduler';
import { CanvasLightingFallback } from './CanvasLightingFallback';
import type { LightingAttempt } from './lightingAttempts';
import { LightingRenderer, type LightingState } from './LightingRenderer';
import { LightingViewHost, type LightingHostState } from './LightingViewHost';
import type { ExploredMemoryWatcher } from './sceneLightingView';

/** The device-local record of attempts to light a view's map (`StoredLightingAttempt`): the engine begins and finishes them, the GM's switch forgets one. */
export interface AttemptRecord extends LightingAttempt {
  /** The GM asks for another attempt on the view's map: its note goes, unless another view is attempting the map right now. */
  forget(): void;
}

/** What the host needs from where it runs: Obsidian's storage and notices in the plugin, the browser's in a client. */
export interface LightingHostPorts {
  /** The record of attempts to light this view's map. */
  attempt: AttemptRecord;
  /** Tells the GM that line of sight stands in for dynamic lighting; `canRetry` when switching it off and on tries again. */
  notify: (canRetry: boolean) => void;
  /** Whether PIXI draws with Canvas 2D, which has no shaders: the line-of-sight fallback from the start, for good. */
  canvasRenderer: (renderer: Renderer) => boolean;
}

export interface LightingHostDeps {
  viewport: Viewport;
  app: Application;
  /** The view's store: the host watches its map, its load and the lighting switch. */
  store: SceneStore<LightingHostState & LightingState>;
  ports: LightingHostPorts;
  measurement: () => MeasurementSettings;
  bounds: () => MapBounds | null;
  /** The map image, for the colours light bounces off. */
  albedo: () => Texture | null;
  /** The grid the composite draws unlit, while there is one (`UnlitGrid`). */
  grid?: () => UnlitGrid | null;
  /** The senses and conditions of the map's collection; the generic ones without it. */
  rules?: () => SightRules;
  /** What the tokens see, or which light reaches them, changed (`playerTokenSight`). */
  onSightChange?: () => void;
  /** Who shows the GM the engine's explored memory while it is edited. */
  exploredWatcher?: ExploredMemoryWatcher;
  /** How much the engine may ask of the graphics device (Atlas' settings on this device); the default quality without one. */
  quality?: LightingQualitySource;
  /** The store as sight and light read it (`followShownPlaces`); the store itself without one. */
  scene?: SceneStore<LightingState>;
}

/**
 * The scene lighting of a map view: the GPU engine where the graphics device runs it, the
 * line-of-sight fallback where it does not (`LightingViewHost` swaps them). The plugin and the
 * player client build it the same way and differ only in their ports.
 */
export function createLightingHost({ viewport, app, store, ports, measurement, bounds, albedo, grid, rules, onSightChange, exploredWatcher, quality, scene = store }: LightingHostDeps): LightingViewHost {
  const sight = onSightChange ? { onSightChange } : {};
  const view = { ...sight, ...(rules && { rules }) };
  return new LightingViewHost({
    store,
    canvasRenderer: ports.canvasRenderer(app.renderer),
    createEngineView: (onUnavailable) => new LightingRenderer({ viewport, app, store: scene, measurement, bounds, albedo, attempt: ports.attempt, onUnavailable, ...view, ...(grid && { grid }), ...(exploredWatcher && { exploredWatcher }), ...(quality && { quality }) }),
    createFallback: () => new CanvasLightingFallback({ viewport, store: scene, measurement, bounds, requestRender: () => requestRender(app), ...view }),
    forgetAttempt: () => ports.attempt.forget(),
    notify: ports.notify,
    ...sight,
  });
}
