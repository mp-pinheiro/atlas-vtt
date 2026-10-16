import { describe, expect, it } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { withHistory, getHistoryStore, isHistoryBusy, onHistorySettled, type HistorySnapshot, type HistoryState } from '../../src/app/stores/history';
import { DeferredSceneWrites, type DeferredSceneRequest } from '../../src/app/online/gm/DeferredSceneWrites';

interface FixtureState extends HistorySnapshot {
  heldTokens: Record<string, unknown>;
  initiative: { entries: string[]; currentIndex: number; round: number };
  initiativeTrackerOpen: boolean;
}
type FixtureStore = StoreApi<FixtureState> & { temporal: StoreApi<HistoryState> };

function fixture(): FixtureStore {
  return createStore<FixtureState>()(withHistory(() => ({ objects: {}, grid: {}, background: null, widgetValues: {}, heldTokens: {}, initiative: { entries: ['a', 'b'], currentIndex: 0, round: 1 }, initiativeTrackerOpen: true })));
}

describe('initiative history branch', () => {
  it('restores order, active index and round together but leaves tracker UI alone', () => {
    const store = fixture();
    const history = getHistoryStore(store)!.getState();
    const before = store.getState().initiative;
    const after = { entries: ['b', 'a'], currentIndex: 1, round: 2 };
    store.setState({ initiative: after });
    store.setState({ initiativeTrackerOpen: false });
    history.undo();
    expect(store.getState().initiative).toBe(before);
    expect(store.getState().initiativeTrackerOpen).toBe(false);
    history.redo();
    expect(store.getState().initiative).toBe(after);
  });

  it('supports a store without an initiative branch', () => {
    const store = createStore(withHistory(() => ({ objects: {}, grid: {}, background: null, widgetValues: {} })));
    const before = store.getState().grid;
    store.setState({ grid: { visible: false } });
    getHistoryStore(store)!.getState().undo();
    expect(store.getState().grid).toBe(before);
    expect('initiative' in store.getState()).toBe(false);
  });
});

describe('settled history notifications', () => {
  it('waits for outermost end, abandon and discard and observes final stacks', () => {
    const store = fixture();
    const history = getHistoryStore(store)!.getState();
    const heard: number[] = [];
    const off = onHistorySettled(store, () => {
      expect(isHistoryBusy(store)).toBe(false);
      heard.push(getHistoryStore(store)!.getState().pastStates.length);
    });
    history.beginTransaction();
    history.beginTransaction();
    store.setState({ grid: { visible: false } });
    history.abandonTransaction();
    expect(heard).toEqual([]);
    history.endTransaction();
    expect(heard).toEqual([1]);
    history.beginTransaction();
    history.beginTransaction();
    history.discardTransaction();
    expect(heard).toEqual([1, 1]);
    history.beginTransaction();
    history.clear();
    expect(heard).toEqual([1, 1, 0]);
    off();
    store.setState({ grid: {} });
    expect(heard).toHaveLength(3);
  });

  it('notifies only after a write and completed undo/redo bookkeeping', () => {
    const store = fixture();
    const history = getHistoryStore(store)!.getState();
    const stacks: number[][] = [];
    store.subscribe(() => expect(isHistoryBusy(store)).toBe(true));
    onHistorySettled(store, () => {
      const now = getHistoryStore(store)!.getState();
      stacks.push([now.pastStates.length, now.futureStates.length]);
    });
    store.setState({ grid: { visible: false } });
    history.undo();
    history.redo();
    expect(stacks).toEqual([[1, 0], [0, 1], [1, 0]]);
  });
});

interface QueueFixture {
  store: FixtureStore;
  writes: DeferredSceneWrites;
  applied: DeferredSceneRequest[];
  cancelled: DeferredSceneRequest[];
  tick(): void;
}

function queueFixture(): QueueFixture {
  const store = fixture();
  const timers = new Map<number, () => void>();
  let serial = 0;
  const applied: DeferredSceneRequest[] = [];
  const cancelled: DeferredSceneRequest[] = [];
  const writes = new DeferredSceneWrites(store, {
    setTimer: (fn) => { const id = ++serial; timers.set(id, fn); return id; },
    clearTimer: (id) => { timers.delete(id); },
    apply: (request) => {
      applied.push(request);
      store.setState({ initiative: { ...store.getState().initiative, round: store.getState().initiative.round + 1 } });
    },
    cancel: (request) => { cancelled.push(request); },
  });
  return { store, writes, applied, cancelled, tick: (): void => {
    const batch = [...timers.values()];
    timers.clear();
    for (const fn of batch) fn();
  } };
}
const condition = (value: number): DeferredSceneRequest => ({ kind: 'condition', from: 'alice', message: { t: 'condition', scene: 'scene', id: 'token', condition: 'hurt', value } });

describe('deferred scene writes', () => {
  it.each(['endTransaction', 'abandonTransaction', 'discardTransaction', 'clear'] as const)('waits for a wall-chain transaction to %s then records separate player steps', (finish) => {
    const f = queueFixture();
    const history = getHistoryStore(f.store)!.getState();
    history.beginTransaction();
    f.store.setState({ objects: { walls: { wall: { x: 1 } } } });
    f.writes.enqueue(condition(1));
    f.writes.enqueue({ kind: 'initiative-roll', from: 'bob', message: { t: 'initiative-roll', scene: 'scene', combatant: 'b' } });
    f.tick();
    expect(f.applied).toEqual([]);
    history[finish]();
    expect(f.applied).toEqual([]);
    f.tick();
    expect(f.applied).toHaveLength(2);
    expect(getHistoryStore(f.store)!.getState().pastStates).toHaveLength(finish === 'endTransaction' ? 3 : 2);
    history.undo();
    expect(f.store.getState().initiative.round).toBe(2);
    history.undo();
    expect(f.store.getState().initiative.round).toBe(1);
    f.writes.stop();
  });

  it('defers all authority kinds through nested holds and coalesces exact turn and approval requests', () => {
    const f = queueFixture();
    const history = getHistoryStore(f.store)!.getState();
    history.beginTransaction();
    history.beginTransaction();
    const turn = { kind: 'end-turn', from: 'alice', message: { t: 'end-turn', scene: 'scene', round: 1, combatant: 'a', turnKey: 'b'.repeat(24) } } as const;
    const approval = { kind: 'approval', from: 'alice', scene: 'scene', id: 'a', request: 'c'.repeat(24) } as const;
    const requests: DeferredSceneRequest[] = [
      turn, approval, condition(1),
      { kind: 'door', from: 'alice', message: { t: 'door', scene: 'scene', id: 'd', request: 'd'.repeat(24) } },
      { kind: 'sheet-roll', from: 'alice', message: { t: 'sheet-roll', sheet: 'e'.repeat(24), index: 0, mode: 'public' } },
      { kind: 'initiative-roll', from: 'alice', message: { t: 'initiative-roll', scene: 'scene', combatant: 'a' } },
    ];
    for (const request of requests) f.writes.enqueue(request);
    f.writes.enqueue(turn);
    f.writes.enqueue(approval);
    expect(f.writes.size).toBe(6);
    history.endTransaction();
    f.tick();
    expect(f.applied).toEqual([]);
    history.abandonTransaction();
    f.tick();
    expect(f.applied).toEqual(requests);
    expect(getHistoryStore(f.store)!.getState().pastStates).toHaveLength(6);
    f.writes.stop();
  });

  it('coalesces absolute edits, preserves doors in order, deduplicates and cancels departures', () => {
    const f = queueFixture();
    f.store.setState({ heldTokens: { token: {} } });
    f.writes.enqueue(condition(1));
    f.writes.enqueue(condition(2));
    const door = { kind: 'door', from: 'bob', message: { t: 'door', scene: 'scene', id: 'd', request: 'a'.repeat(24) } } as const;
    f.writes.enqueue(door);
    f.writes.enqueue(door);
    expect(f.writes.size).toBe(2);
    expect(f.cancelled).toEqual([condition(1)]);
    f.store.setState({ heldTokens: {} });
    expect(f.applied).toEqual([]);
    f.tick();
    expect(f.applied).toEqual([condition(2), door]);
    f.writes.enqueue(door);
    expect(f.applied).toHaveLength(2);
    f.store.setState({ heldTokens: { token: {} } });
    f.writes.enqueue(condition(3));
    f.writes.clearPlayer('alice');
    expect(f.cancelled).toEqual([condition(1), condition(3)]);
    f.writes.stop();
  });

  it('bounds the queue and snapshots immutable requests', () => {
    const f = queueFixture();
    f.store.setState({ heldTokens: { token: {} } });
    for (let i = 0; i < 128; i++) expect(f.writes.enqueue({ kind: 'initiative-roll', from: 'alice', message: { t: 'initiative-roll', scene: 'scene', combatant: String(i) } })).toBe(true);
    expect(f.writes.enqueue(condition(1))).toBe(false);
    expect(f.writes.size).toBe(128);
    f.writes.clear();
    const message = { t: 'condition' as const, scene: 'scene', id: 'token', condition: 'hurt', value: 1 };
    f.writes.enqueue({ kind: 'condition', from: 'alice', message });
    message.value = 99;
    f.store.setState({ heldTokens: {} });
    f.tick();
    expect(f.applied).toEqual([condition(1)]);
    f.writes.stop();
  });
});
