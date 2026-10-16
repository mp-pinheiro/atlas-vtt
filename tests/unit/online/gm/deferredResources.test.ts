import { describe, expect, it } from 'vitest';
import { ResourceWrites, type DeferredResourceRequest } from '../../../../src/app/online/gm/book/resourceWrites';
import { beginHistoryTransaction, endHistoryTransaction, runUntracked, getHistoryStore } from '../../../../src/app/stores/history';
import { createViewAtlasStore } from '../../../../src/app/storeFactory';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { token } from './shareHarness';

const ANA = 'a'.repeat(20);

describe('resources deferred behind non-token gestures', () => {
  it('answers overwritten edits and keeps accepted resources out of the wall-chain step', () => {
    const { app } = createInMemoryApp();
    const store = createViewAtlasStore(app, 'deferred-resources');
    const history = getHistoryStore(store)!;
    runUntracked(store, () => store.setState((draft) => {
      draft.persistenceEnabled = false;
      draft.mapLoaded = true;
      draft.objects.tokens.ogre = token('ogre');
      draft.objects.tokens.ogre!.resources = { hp: { current: 7, max: 12 } };
    }));
    const timers = new Map<number, () => void>();
    let serial = 0;
    const resources = new ResourceWrites(store, {
      definitions: () => [{ key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#cc3333', visibleToPlayers: true }],
      ownerOf: () => ANA,
      now: () => 0,
      setTimer: (fn) => { const id = ++serial; timers.set(id, fn); return id; },
      clearTimer: (id) => { timers.delete(id); },
    });
    const answers: (number | null)[] = [];
    beginHistoryTransaction(store);
    store.getState().addWall({ type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 } });
    resources.write({ kind: 'token', from: ANA, tokenId: 'ogre', key: 'hp', current: 5 }, (value) => answers.push(value));
    resources.write({ kind: 'token', from: ANA, tokenId: 'ogre', key: 'hp', current: 4 }, (value) => answers.push(value));
    expect(answers).toEqual([null]);
    expect(store.getState().objects.tokens.ogre!.resources!.hp!.current).toBe(7);
    endHistoryTransaction(store);
    expect(answers).toEqual([null]);
    for (const fn of [...timers.values()]) fn();
    timers.clear();
    expect(answers).toEqual([null, 4]);
    expect(history.getState().pastStates).toHaveLength(2);
    history.getState().undo();
    expect(store.getState().objects.tokens.ogre!.resources!.hp!.current).toBe(7);
    expect(Object.keys(store.getState().objects.walls)).toHaveLength(1);
    resources.stop();
  });

  it('uses an injected scene queue and refuses departed players and replaced map identity', () => {
    const { app } = createInMemoryApp();
    const store = createViewAtlasStore(app, 'shared-deferred-resources');
    runUntracked(store, () => store.setState((draft) => {
      draft.persistenceEnabled = false;
      draft.mapLoaded = true;
      draft.mapPath = 'first';
      draft.objects.tokens.ogre = token('ogre', { resources: { hp: { current: 7, max: 12 } } });
    }));
    const queued: DeferredResourceRequest[] = [];
    const answers: (number | null)[] = [];
    let online = true;
    let timers = 0;
    const resources = new ResourceWrites(store, {
      definitions: () => [{ key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#cc3333', visibleToPlayers: true }],
      ownerOf: () => ANA,
      online: () => online,
      defer: (request) => { queued.push(request); return true; },
      now: () => 0,
      setTimer: () => ++timers,
      clearTimer: () => { timers--; },
    });
    const edit = { kind: 'token', from: ANA, tokenId: 'ogre', key: 'hp', current: 4 } as const;
    resources.write(edit, (value) => answers.push(value));
    expect(timers).toBe(0);
    store.setState({ mapPath: 'second' });
    resources.applyDeferred(queued[0]!);
    expect(answers).toEqual([null]);
    resources.write(edit, (value) => answers.push(value));
    online = false;
    resources.applyDeferred(queued[1]!);
    expect(answers).toEqual([null, null]);
    online = true;
    resources.write(edit, (value) => answers.push(value));
    resources.playerLeft(ANA);
    resources.applyDeferred(queued[2]!);
    expect(answers).toEqual([null, null, null]);
    resources.write(edit, (value) => answers.push(value));
    resources.stop();
    resources.applyDeferred(queued[3]!);
    expect(answers).toEqual([null, null, null, null]);
    expect(store.getState().objects.tokens.ogre!.resources!.hp!.current).toBe(7);
  });
});
