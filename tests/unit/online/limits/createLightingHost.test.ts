import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application, Renderer } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createLightingHost, type AttemptRecord, type LightingHostDeps, type LightingHostPorts } from '../../../../src/app/pixi/lighting/createLightingHost';
import type { SceneStore } from '../../../../src/app/lighting/shownTokens';
import type { LightingRendererDeps, LightingState, LightingUnavailable } from '../../../../src/app/pixi/lighting/LightingRenderer';
import { DEFAULT_SCENE_LIGHTING } from '../../../../src/app/types/lightingTypes';
import { GENERIC_SIGHT_RULES } from '../../../../src/app/vision/sightRules';

const built = vi.hoisted(() => ({ engine: [] as unknown[], fallback: [] as unknown[], reasons: [] as ((reason: LightingUnavailable) => void)[] }));

vi.mock('../../../../src/app/pixi/lighting/LightingRenderer', () => ({
  LightingRenderer: class {
    modeLayer = { visible: false };
    constructor(deps: LightingRendererDeps) {
      built.engine.push(deps);
      if (deps.onUnavailable) built.reasons.push(deps.onUnavailable);
    }
    destroy(): void {}
  },
}));
vi.mock('../../../../src/app/pixi/lighting/CanvasLightingFallback', () => ({
  CanvasLightingFallback: class {
    modeLayer = { visible: false };
    constructor(deps: unknown) { built.fallback.push(deps); }
    destroy(): void {}
  },
}));

type HostedState = { mapPath: string | null; isMapLoading: boolean; lighting: { enabled: boolean } };

const RENDERER = { name: 'webgl' } as unknown as Renderer;

interface Setup {
  host: ReturnType<typeof createLightingHost>;
  ports: LightingHostPorts;
  store: StoreApi<HostedState>;
  canvasRenderer: ReturnType<typeof vi.fn<(renderer: Renderer) => boolean>>;
  notify: ReturnType<typeof vi.fn<(canRetry: boolean) => void>>;
  forget: ReturnType<typeof vi.fn<() => void>>;
}

function setup(canvas: boolean, extra: Partial<LightingHostDeps> = {}): Setup {
  const store = createStore<HostedState>(() => ({ mapPath: 'maps/cave.atlasmap', isMapLoading: false, lighting: { ...DEFAULT_SCENE_LIGHTING, enabled: true } }));
  const canvasRenderer = vi.fn<(renderer: Renderer) => boolean>(() => canvas);
  const notify = vi.fn<(canRetry: boolean) => void>();
  const forget = vi.fn<() => void>();
  const attempt: AttemptRecord = { begin: () => true, finish: () => undefined, forget };
  const ports: LightingHostPorts = { attempt, notify, canvasRenderer };
  const host = createLightingHost({
    viewport: {} as Viewport,
    app: { renderer: RENDERER } as Application,
    store: store as unknown as LightingHostDeps['store'],
    ports,
    measurement: () => ({ unitDistance: 5 }) as never,
    bounds: () => null,
    albedo: () => null,
    ...extra,
  });
  return { host, ports, store, canvasRenderer, notify, forget };
}

beforeEach(() => {
  built.engine.length = 0;
  built.fallback.length = 0;
  built.reasons.length = 0;
});

describe('the lighting host a view is given', () => {
  it('asks the renderer probe it was given, with the app\'s renderer', () => {
    const { canvasRenderer, host } = setup(false);
    expect(canvasRenderer).toHaveBeenCalledOnce();
    expect(canvasRenderer).toHaveBeenCalledWith(RENDERER);
    host.destroy();
  });

  it('builds the GPU engine where PIXI does not draw with Canvas 2D, with the attempt record it was given', () => {
    const { host, ports } = setup(false);
    expect(built.engine).toHaveLength(1);
    expect(built.fallback).toHaveLength(0);
    expect(built.engine[0]).toMatchObject({ attempt: ports.attempt });
    host.destroy();
  });

  it('builds the line-of-sight fallback from the start where PIXI draws with Canvas 2D', () => {
    const { host, notify } = setup(true);
    expect(built.engine).toHaveLength(0);
    expect(built.fallback).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    host.destroy();
  });

  it('gives both views the map\'s sight rules and its report of new sight, when it has them', () => {
    const rules = (): typeof GENERIC_SIGHT_RULES => GENERIC_SIGHT_RULES;
    const onSightChange = vi.fn();
    const engine = setup(false, { rules, onSightChange });
    expect(built.engine[0]).toMatchObject({ rules, onSightChange });
    engine.host.destroy();
    const fallback = setup(true, { rules, onSightChange });
    expect(built.fallback[0]).toMatchObject({ rules, onSightChange });
    fallback.host.destroy();
  });

  it('leaves out what it was not given instead of passing it on empty', () => {
    const { host } = setup(false);
    for (const key of ['rules', 'onSightChange', 'grid', 'exploredWatcher', 'quality']) expect(built.engine[0]).not.toHaveProperty(key);
    host.destroy();
  });

  it('lets both views read the store as sight and light read it, the view\'s own store without one', () => {
    const { host, store } = setup(false);
    expect(built.engine[0]).toMatchObject({ store });
    host.destroy();
    const scene = { getState: () => ({}), subscribe: () => () => undefined } as unknown as SceneStore<LightingState>;
    const shown = setup(true, { scene });
    expect(built.fallback[0]).toMatchObject({ store: scene });
    shown.host.destroy();
  });

  it('puts the fallback in the engine\'s place and tells the GM once, when the last attempt on the map never finished', () => {
    const { host, notify, forget } = setup(false);
    built.reasons[0]!('unfinished');
    expect(built.fallback).toHaveLength(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith(true);
    expect(forget).not.toHaveBeenCalled();
    host.destroy();
  });

  it('forgets the attempt and tells the GM there is no retry, when the engine fails', () => {
    const { host, notify, forget } = setup(false);
    built.reasons[0]!('failed');
    expect(built.fallback).toHaveLength(1);
    expect(forget).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledExactlyOnceWith(false);
    host.destroy();
  });

  it('forgets the attempt through the record it was given when the GM switches lighting off', () => {
    const { host, store, forget } = setup(false);
    built.reasons[0]!('unfinished');
    expect(forget).not.toHaveBeenCalled();
    store.setState({ lighting: { ...DEFAULT_SCENE_LIGHTING, enabled: false } });
    expect(forget).toHaveBeenCalledOnce();
    expect(built.engine).toHaveLength(2);
    host.destroy();
  });
});
