import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { PendingPaths, type ApprovalRequest } from '../../../../src/app/online/gm/PendingPaths';
import { DeferredSceneWrites } from '../../../../src/app/online/gm/DeferredSceneWrites';
import { sceneWalls } from '../../../../src/app/online/gm/moveCheck';
import { beginHistoryTransaction, endHistoryTransaction, abandonHistoryTransaction, runUntracked } from '../../../../src/app/stores/history';
import { ALIAS, ANA, BEN, SCENE, STORE_FACTORY, table, type StoreFactory } from './realStore';
import type { Table } from './realStore';

const { createViewAtlasStore } = await import(STORE_FACTORY) as { createViewAtlasStore: StoreFactory };
const request = (n: number): string => n.toString(16).padStart(24, '0');
function harness(movementAllowed: () => boolean = () => true): { t: Table; paths: PendingPaths; writes: DeferredSceneWrites; remind: Mock; stop(): void } {
  const t = table(createViewAtlasStore);
  const remind = vi.fn();
  let paths: PendingPaths;
  const writes = new DeferredSceneWrites(t.store, {
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: id => clearTimeout(id),
    apply: item => { if (item.kind === 'approval') paths.apply(item.from, item); },
    cancel: item => { if (item.kind === 'approval') paths.cancelApproval(item); },
  });
  paths = new PendingPaths(t.store, {
    context: () => ({ scene: SCENE, tokens: t.store.getState().objects.tokens, listedToken: id => id === ALIAS.ogre ? 'ogre' : id === ALIAS.bear ? 'bear' : undefined, ownerOf: id => id === 'ogre' ? ANA : BEN, map: { width: 2000, height: 1500 }, walls: sceneWalls(t.store.getState().objects.walls, true, { width: 2000, height: 1500 }) }),
    approval: () => true, online: () => true, movementAllowed,
    defer: (item: ApprovalRequest) => writes.enqueue(item),
    send: (body, to) => t.sent.push({ body, to }), now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimer: id => clearTimeout(id), reminder: remind,
  });
  return { t, paths, writes, remind, stop: () => { paths.stop(); writes.stop(); t.moves.stop(); } };
}
const propose = (paths: PendingPaths, n = 1, points = [{ x: 315, y: 105 }]): void => paths.receive(ANA, { t: 'path', scene: SCENE, id: ALIAS.ogre, request: request(n), points });
describe('authoritative proposed paths', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('stops the entire sequence at its first blocked segment and undo restores the stack', () => {
    const h = harness();
    runUntracked(h.t.store, () => h.t.store.setState(s => { s.objects.walls = { wall: { id: 'wall', kind: 'wall', type: 'door', closed: true, p1: { x: 200, y: 0 }, p2: { x: 200, y: 1500 } } }; }));
    propose(h.paths, 1, [{ x: 300, y: 105 }, { x: 600, y: 800 }]);
    h.paths.approve(request(1));
    const token = h.t.store.getState().objects.tokens.ogre;
    expect(token?.x).toBeLessThan(200); expect(token?.y).toBe(105);
    expect(h.t.history.getState().pastStates).toHaveLength(1);
    expect(h.t.sent.at(-1)?.body).toMatchObject({ t: 'path-result', result: 'approved', reason: 'blocked', points: [{ x: token?.x, y: 105 }] });
    h.t.history.getState().undo(); expect(h.t.store.getState().objects.tokens.ogre).toMatchObject({ x: 105, y: 105, layer: 0 });
    expect(h.paths.getSnapshot()).toHaveLength(0); h.stop();
  });
  it.each(['end', 'abandon'] as const)('does not join an open GM transaction closed by %s', finish => {
    const h = harness(); beginHistoryTransaction(h.t.store);
    propose(h.paths); h.paths.approve(request(1));
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(105);
    if (finish === 'end') endHistoryTransaction(h.t.store); else abandonHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(315);
    expect(h.t.history.getState().pastStates).toHaveLength(1); h.stop();
  });
  it('snapshots bulk request IDs and creates a separate history step for each', () => {
    const h = harness(); propose(h.paths);
    h.paths.receive(BEN, { t: 'path', scene: SCENE, id: ALIAS.bear, request: request(2), points: [{ x: 600, y: 105 }] });
    h.paths.approveAll(); expect(h.t.history.getState().pastStates).toHaveLength(2); expect(h.paths.getSnapshot()).toHaveLength(0); h.stop();
  });
  it('correlates replacements, ignores old cancellation and rejects a moved proposal', () => {
    const h = harness(); propose(h.paths); propose(h.paths, 2);
    expect(h.t.sent.at(-1)?.body).toMatchObject({ request: request(1), result: 'cancelled', reason: 'replaced' });
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(1) });
    expect(h.paths.getSnapshot()).toHaveLength(1);
    h.t.store.getState().moveToken('ogre', 106, 105);
    expect(h.paths.getSnapshot()).toHaveLength(0);
    h.paths.approve(request(2)); expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(106); h.stop();
  });
  it('edits, inserts, deletes and restores the pre-edit path and enforces destination limits', () => {
    const h = harness(); propose(h.paths); h.paths.beginEdit(request(1));
    expect(h.paths.editPoint(request(1), 0, { x: 400, y: 105 })).toBe(true);
    expect(h.paths.insertPoint(request(1), 0, { x: 200, y: 105 })).toBe(true);
    expect(h.paths.deletePoint(request(1), 1)).toBe(true);
    expect(h.paths.deletePoint(request(1), 0)).toBe(false);
    h.paths.endEdit(false); expect(h.paths.getSnapshot()[0]?.points).toEqual([{ x: 315, y: 105 }]);
    h.paths.beginEdit(request(1));
    for (let i = 0; i < 31; i++) expect(h.paths.insertPoint(request(1), 0, { x: 200, y: 105 })).toBe(true);
    expect(h.paths.insertPoint(request(1), 0, { x: 200, y: 105 })).toBe(false);
    h.paths.endEdit(true); h.stop();
  });
  it('reminds the GM once and removes timers for cancelled and departed requests', () => {
    const h = harness(); propose(h.paths); vi.advanceTimersByTime(30_001); expect(h.remind).toHaveBeenCalledTimes(1);
    h.paths.reconcile(); vi.advanceTimersByTime(60_000); expect(h.remind).toHaveBeenCalledTimes(1);
    h.paths.playerLeft(ANA); expect(h.paths.getSnapshot()).toHaveLength(0); propose(h.paths, 2); h.paths.sceneChanged();
    vi.advanceTimersByTime(60_000); expect(h.remind).toHaveBeenCalledTimes(1); h.stop();
  });
  it('cancels only the matching proposal even after the movement budget is exhausted and approval is queued', () => {
    let allowed = true;
    const h = harness(() => allowed);
    propose(h.paths);
    beginHistoryTransaction(h.t.store);
    h.paths.approve(request(1));
    expect(h.writes.size).toBe(1);
    allowed = false;
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(1) });
    expect(h.paths.getSnapshot()).toEqual([]);
    expect(h.t.sent.at(-1)?.body).toEqual({ t: 'path-result', scene: SCENE, id: ALIAS.ogre, request: request(1), result: 'cancelled' });
    endHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(105);
    expect(h.t.history.getState().pastStates).toHaveLength(0);
    h.stop();
  });
  it('does not let a forged or obsolete cancellation remove another request', () => {
    const h = harness();
    propose(h.paths);
    h.paths.receive(BEN, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(1) });
    h.paths.receive(ANA, { t: 'path-cancel', scene: `${SCENE}-old`, id: ALIAS.ogre, request: request(1) });
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.bear, request: request(1) });
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(2) });
    expect(h.paths.getSnapshot().map(path => path.request)).toEqual([request(1)]);
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(1) });
    expect(h.paths.getSnapshot()).toEqual([]);
    h.stop();
  });
  it('does not undo a path that has already been approved', () => {
    const h = harness();
    propose(h.paths);
    h.paths.approve(request(1));
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(1) });
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(315);
    expect(h.t.sent.at(-1)?.body).toMatchObject({ t: 'path-result', request: request(1), result: 'approved' });
    h.stop();
  });
  it('does not let a deferred approval of a replaced request approve its successor', () => {
    const h = harness();
    beginHistoryTransaction(h.t.store);
    propose(h.paths);
    h.paths.approve(request(1));
    propose(h.paths, 2);
    expect(h.paths.getSnapshot().map(path => path.request)).toEqual([request(2)]);
    endHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(105);
    expect(h.paths.getSnapshot().map(path => path.request)).toEqual([request(2)]);
    h.paths.approve(request(2));
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(315);
    h.stop();
  });
  it('cannot recycle a cancelled request into an approval the GM never gave', () => {
    const h = harness();
    beginHistoryTransaction(h.t.store);
    propose(h.paths, 1, [{ x: 315, y: 105 }]);
    h.paths.approve(request(1));
    h.paths.receive(ANA, { t: 'path-cancel', scene: SCENE, id: ALIAS.ogre, request: request(1) });
    propose(h.paths, 1, [{ x: 900, y: 105 }]);
    expect(h.paths.getSnapshot()).toEqual([]);
    endHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(105);
    expect(h.t.history.getState().pastStates).toHaveLength(0);
    expect(h.t.sent.some(({ body }) => body.t === 'path-result' && body.result === 'approved')).toBe(false);
    h.stop();
  });
  it('requires a new GM approval for a changed path while a write waits', () => {
    const h = harness();
    beginHistoryTransaction(h.t.store);
    propose(h.paths);
    h.paths.approve(request(1));
    h.paths.beginEdit(request(1));
    h.paths.editPoint(request(1), 0, { x: 900, y: 105 });
    h.paths.endEdit(true);
    h.paths.approve(request(1));
    endHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(900);
    expect(h.t.history.getState().pastStates).toHaveLength(1);
    h.stop();
  });
  it('invalidates deferred approvals on player disconnect and scene change', () => {
    const h = harness();
    beginHistoryTransaction(h.t.store);
    propose(h.paths);
    h.paths.approve(request(1));
    h.paths.playerLeft(ANA);
    h.paths.receive(BEN, { t: 'path', scene: SCENE, id: ALIAS.bear, request: request(2), points: [{ x: 600, y: 105 }] });
    h.paths.approve(request(2));
    h.paths.sceneChanged();
    endHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre?.x).toBe(105);
    expect(h.t.store.getState().objects.tokens.bear?.x).toBe(315);
    expect(h.paths.getSnapshot()).toEqual([]);
    h.stop();
  });
  it('revalidates every item of a deferred bulk approval before applying it', () => {
    const h = harness();
    beginHistoryTransaction(h.t.store);
    propose(h.paths);
    h.paths.receive(BEN, { t: 'path', scene: SCENE, id: ALIAS.bear, request: request(2), points: [{ x: 600, y: 105 }] });
    h.paths.approveAll();
    expect(h.writes.size).toBe(2);
    h.t.store.getState().moveToken('ogre', 500, 500);
    expect(h.paths.getSnapshot().map(path => path.request)).toEqual([request(2)]);
    endHistoryTransaction(h.t.store);
    vi.advanceTimersByTime(0);
    expect(h.t.store.getState().objects.tokens.ogre).toMatchObject({ x: 500, y: 500 });
    expect(h.t.store.getState().objects.tokens.bear?.x).toBe(600);
    expect(h.t.sent.some(entry => entry.body.t === 'path-result' && entry.body.request === request(1) && entry.body.result === 'cancelled' && entry.body.reason === 'stale')).toBe(true);
    expect(h.t.sent.some(entry => entry.body.t === 'path-result' && entry.body.request === request(2) && entry.body.result === 'approved')).toBe(true);
    h.stop();
  });
});
