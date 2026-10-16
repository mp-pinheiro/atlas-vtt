import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerDoors, type DoorStore, type PlayerDoorContext, type PlayerDoorPorts } from '../../../../src/app/online/gm/PlayerDoors';
import { DeferredSceneWrites } from '../../../../src/app/online/gm/DeferredSceneWrites';
import { beginHistoryTransaction, endHistoryTransaction, runUntracked } from '../../../../src/app/stores/history';
import { ALIAS, ANA, SCENE, STORE_FACTORY, table, type StoreFactory, type Table } from './realStore';
import type { PlayerAgencyMessage } from '../../../../src/app/online/protocol/agency';

const { createViewAtlasStore } = await import(STORE_FACTORY) as { createViewAtlasStore: StoreFactory };
type Request = Extract<PlayerAgencyMessage, { t: 'door' }>;
interface Harness { readonly t: Table; readonly doors: PlayerDoors; readonly writes: DeferredSceneWrites; context: PlayerDoorContext; rebind(): void; stop(): void }
function harness(): Harness {
  const t = table(createViewAtlasStore);
  runUntracked(t.store, () => t.store.setState(s => { s.objects.walls = { door: { id: 'door', kind: 'wall', type: 'door', closed: true, p1: { x: 175, y: 70 }, p2: { x: 175, y: 140 } } }; }));
  let doors: PlayerDoors;
  const writes = new DeferredSceneWrites(t.store, { setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimer: id => clearTimeout(id), apply: item => { if (item.kind === 'door') doors.apply(item.from, item.message); }, cancel: item => { if (item.kind === 'door') doors.cancel(item.from, item.message); } });
  const h: Harness = {
    t, writes, get doors(): PlayerDoors { return doors; },
    context: { scene: SCENE, enabled: true, lit: true, gridSize: 70, walls: t.store.getState().objects.walls, tokens: t.store.getState().objects.tokens, listedDoor: id => id === ALIAS.bear ? 'door' : undefined, listedToken: id => id === 'ogre', ownerOf: id => id === 'ogre' ? ANA : undefined, visibleDoor: () => true },
    rebind: () => { doors.stop(); doors = new PlayerDoors(t.store as unknown as DoorStore, ports); },
    stop: () => { doors.stop(); writes.stop(); t.moves.stop(); },
  };
  const ports: PlayerDoorPorts = { nonces: new Map(), context: () => ({ ...h.context, walls: t.store.getState().objects.walls, tokens: t.store.getState().objects.tokens }), movementAllowed: () => true, defer: item => writes.enqueue(item), send: (body, to) => t.sent.push({ body, to }) };
  doors = new PlayerDoors(t.store as unknown as DoorStore, ports);
  return h;
}
const request = (n = 1): Request => ({ t: 'door', scene: SCENE, id: ALIAS.bear, request: n.toString(16).padStart(24, '0') });
describe('player door authority', () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  it('includes exactly one-cell proximity and deduplicates nonces for the connection', () => {
    const h = harness(); h.doors.receive(ANA, request()); h.doors.receive(ANA, request());
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(false);
    expect(h.t.history.getState().pastStates).toHaveLength(1);
    expect(h.t.sent).toHaveLength(1); expect(h.t.sent[0]?.body).toMatchObject({ result: 'opened' });
    h.t.history.getState().undo(); expect(h.t.store.getState().objects.walls.door?.closed).toBe(true);
    h.doors.receive(ANA, request()); expect(h.t.store.getState().objects.walls.door?.closed).toBe(true); h.stop();
  });
  it('keeps an already applied nonce spent when the presented view is rebuilt', () => {
    const h = harness();
    h.doors.receive(ANA, request());
    h.rebind();
    h.context = { ...h.context, scene: 'rebuilt-view' };
    h.doors.receive(ANA, { ...request(), scene: 'rebuilt-view' });
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(false);
    expect(h.t.history.getState().pastStates).toHaveLength(1);
    h.doors.receive(ANA, { ...request(2), scene: 'rebuilt-view' });
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(true);
    h.doors.playerLeft(ANA);
    h.writes.clearPlayer(ANA);
    h.doors.receive(ANA, { ...request(), scene: 'rebuilt-view' });
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(false);
    expect(h.t.history.getState().pastStates).toHaveLength(3);
    h.stop();
  });
  it.each(['enabled', 'lit', 'visible', 'owner', 'listed', 'scene', 'distance', 'secret', 'locked'] as const)('refuses without revealing the reason: %s', reason => {
    const h = harness();
    if (reason === 'enabled') h.context = { ...h.context, enabled: false };
    if (reason === 'lit') h.context = { ...h.context, lit: false };
    if (reason === 'visible') h.context = { ...h.context, visibleDoor: () => false };
    if (reason === 'owner') h.context = { ...h.context, ownerOf: () => undefined };
    if (reason === 'listed') h.context = { ...h.context, listedToken: () => false };
    if (reason === 'scene') h.context = { ...h.context, scene: 'another' };
    if (reason === 'distance') runUntracked(h.t.store, () => h.t.store.setState(s => { const token = s.objects.tokens.ogre; if (token) token.x -= 0.01; }));
    if (reason === 'secret' || reason === 'locked') runUntracked(h.t.store, () => h.t.store.setState(s => { const door = s.objects.walls.door; if (door) { if (reason === 'secret') door.type = 'secret-door'; else door.locked = true; } }));
    h.doors.receive(ANA, request()); expect(h.t.sent.at(-1)?.body).toEqual({ t: 'door-result', scene: SCENE, id: ALIAS.bear, request: request().request, result: 'refused' });
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(true); h.stop();
  });
  it('rechecks fog and proximity after history settles instead of writing inside the hold', () => {
    const h = harness(); beginHistoryTransaction(h.t.store); h.doors.receive(ANA, request());
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(true);
    h.context = { ...h.context, visibleDoor: () => false };
    endHistoryTransaction(h.t.store); vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.walls.door?.closed).toBe(true); expect(h.t.sent.at(-1)?.body).toMatchObject({ result: 'refused' }); h.stop();
  });
  it('clears queued requests on scene change and permits a new nonce on the current scene', () => {
    const h = harness(); beginHistoryTransaction(h.t.store); h.doors.receive(ANA, request()); h.doors.sceneChanged();
    endHistoryTransaction(h.t.store); vi.advanceTimersByTime(0); expect(h.t.store.getState().objects.walls.door?.closed).toBe(true);
    h.doors.receive(ANA, request(2)); expect(h.t.store.getState().objects.walls.door?.closed).toBe(false); h.stop();
  });
});
