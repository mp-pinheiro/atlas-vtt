import type { App } from 'obsidian';
import type { SceneStore } from '../../lighting/shownTokens';
import type { ViewAtlasState, ViewAtlasStore } from '../../storeFactory';
import { usesCanvasRenderer } from '../utils/rendererType';
import { createLightingHost, type LightingHostDeps, type LightingHostPorts } from './createLightingHost';
import { StoredLightingAttempt } from './lightingAttempts';
import { showLightingUnavailableNotice } from './lightingNotices';
import type { LightingViewHost } from './LightingViewHost';

export interface SceneLightingDeps extends Omit<LightingHostDeps, 'store' | 'scene' | 'ports'> {
  store: ViewAtlasStore;
  obsApp: App;
  /** The store as sight and light read it (`followShownPlaces`); the store itself without one. */
  scene?: SceneStore<ViewAtlasState>;
}

/**
 * The scene lighting of a map view in the plugin: `createLightingHost` with Obsidian's local
 * storage for the attempts, its notices, and PIXI's own renderer check.
 */
export function createSceneLighting({ obsApp, store, scene, ...deps }: SceneLightingDeps): LightingViewHost {
  const ports: LightingHostPorts = {
    attempt: new StoredLightingAttempt(obsApp, () => store.getState().mapPath),
    notify: showLightingUnavailableNotice,
    canvasRenderer: usesCanvasRenderer,
  };
  return createLightingHost({ ...deps, store, ...(scene && { scene }), ports });
}
