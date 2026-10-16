import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { EVENT_RETRY_MS } from '../src/table/limits.ts';
import { Scheduler, type EventHandlers } from '../src/table/scheduler.ts';
import { createSchema, dueEvents, upsertEvent } from '../src/table/store.ts';
import { tableNames } from './helpers.ts';
import { at, consumed, untouchedStub, withScheduler } from './schedulerHarness.ts';

afterEach(async () => {
  await reset();
});

describe('runDue', () => {
  const recording = (ran: string[]): EventHandlers => ({ cleanup: (subject) => { ran.push(subject); return Promise.resolve(); } });

  it('runs what is due in the order of the moments, then of the subjects, and not what is not', async () => {
    const seen = await withScheduler(at(500), async (scheduler, state) => {
      const ran: string[] = [];
      for (const [subject, due] of [['c', 300], ['b', 200], ['a', 200], ['late', 501]] as const) await scheduler.schedule('cleanup', subject, at(due));
      await consumed(state);
      await scheduler.runDue(recording(ran));
      return { ran, left: dueEvents(state.storage.sql, at(10_000)), alarm: await state.storage.getAlarm() };
    });
    expect(seen.ran).toEqual(['a', 'b', 'c']);
    expect(seen.left).toEqual([{ kind: 'cleanup', subject: 'late', due: at(501) }]);
    expect(seen.alarm).toBe(at(501));
  });

  it('runs an event at the very moment it is due, and not a moment before', async () => {
    const ran = await withScheduler(at(1_000), async (scheduler) => {
      const ran: string[] = [];
      await scheduler.schedule('cleanup', 'due', at(1_000));
      await scheduler.schedule('cleanup', 'next', at(1_001));
      await scheduler.runDue(recording(ran));
      return ran;
    });
    expect(ran).toEqual(['due']);
  });

  it('sets no alarm when nothing is left', async () => {
    const alarm = await withScheduler(at(5_000), async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'a', at(1_000));
      await consumed(state);
      await scheduler.runDue(recording([]));
      return state.storage.getAlarm();
    });
    expect(alarm).toBeNull();
  });

  it('keeps an event whose handler throws, runs the others, and does not throw', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      const ran: string[] = [];
      await scheduler.schedule('cleanup', 'a', at(100));
      await scheduler.schedule('cleanup', 'bad', at(200));
      await scheduler.schedule('cleanup', 'c', at(300));
      await consumed(state);
      await scheduler.runDue({ cleanup: (subject) => (subject === 'bad' ? Promise.reject(new Error('A bad row.')) : recording(ran).cleanup(subject)) });
      return { ran, left: dueEvents(state.storage.sql, at(100_000)), alarm: await state.storage.getAlarm() };
    });
    expect(seen.ran).toEqual(['a', 'c']);
    // The failed event waits the retry delay from the moment the run began, and the alarm is set for it.
    expect(seen.left).toEqual([{ kind: 'cleanup', subject: 'bad', due: at(1_000) + EVENT_RETRY_MS }]);
    expect(seen.alarm).toBe(at(1_000) + EVENT_RETRY_MS);
  });

  it('runs an event again after its handler threw once, and removes it when that run succeeds', async () => {
    const seen = await runInDurableObject(untouchedStub(), async (_table, state) => {
      createSchema(state.storage.sql);
      let now = at(1_000);
      const scheduler = new Scheduler(state.storage, () => now);
      const attempts: string[] = [];
      let failures = 1;
      const handlers: EventHandlers = {
        cleanup: (subject) => {
          attempts.push(subject);
          if (failures > 0) { failures -= 1; return Promise.reject(new Error('A transient failure.')); }
          return Promise.resolve();
        },
      };
      await scheduler.schedule('cleanup', 'table', at(100));
      await consumed(state);
      await scheduler.runDue(handlers);
      const afterFailure = { left: dueEvents(state.storage.sql, at(1_000_000)), alarm: await state.storage.getAlarm() };
      // Before the retry delay is over nothing is due, so the handler is not called again.
      now = at(1_000) + EVENT_RETRY_MS - 1;
      await consumed(state);
      await scheduler.runDue(handlers);
      const early = attempts.length;
      now = at(1_000) + EVENT_RETRY_MS;
      await consumed(state);
      await scheduler.runDue(handlers);
      return { attempts, early, afterFailure, left: dueEvents(state.storage.sql, at(1_000_000)), alarm: await state.storage.getAlarm() };
    });
    expect(seen.afterFailure).toEqual({ left: [{ kind: 'cleanup', subject: 'table', due: at(1_000) + EVENT_RETRY_MS }], alarm: at(1_000) + EVENT_RETRY_MS });
    expect(seen.early).toBe(1);
    expect(seen.attempts).toEqual(['table', 'table']);
    expect(seen.left).toEqual([]);
    expect(seen.alarm).toBeNull();
  });

  it('keeps trying an event whose handler keeps throwing, one retry delay apart', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'stuck', at(100));
      const dues: number[] = [];
      for (let round = 0; round < 3; round += 1) {
        const [next] = dueEvents(state.storage.sql, at(1_000_000));
        dues.push(next?.due ?? 0);
        const run = new Scheduler(state.storage, () => dues[round] ?? 0);
        await consumed(state);
        await run.runDue({ cleanup: () => Promise.reject(new Error('Still failing.')) });
      }
      return { dues, left: dueEvents(state.storage.sql, at(1_000_000)).length };
    });
    expect(seen.dues).toEqual([at(100), at(100) + EVENT_RETRY_MS, at(100) + 2 * EVENT_RETRY_MS]);
    expect(seen.left).toBe(1);
  });

  it('leaves an event its handler scheduled again before it threw where the handler put it', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'again', at(100));
      await consumed(state);
      await scheduler.runDue({ cleanup: async (subject) => { await scheduler.schedule('cleanup', subject, at(4_000)); throw new Error('After it scheduled itself.'); } });
      return dueEvents(state.storage.sql, at(1_000_000));
    });
    expect(seen).toEqual([{ kind: 'cleanup', subject: 'again', due: at(4_000) }]);
  });

  it('does not bring back an event its handler cancelled before it threw', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'cancelled', at(100));
      await consumed(state);
      await scheduler.runDue({ cleanup: (subject) => { scheduler.cancel('cleanup', subject); return Promise.reject(new Error('After it cancelled itself.')); } });
      return { left: dueEvents(state.storage.sql, at(1_000_000)), alarm: await state.storage.getAlarm() };
    });
    expect(seen).toEqual({ left: [], alarm: null });
  });

  it('drops an event of a kind it has no handler for, also one named like a property of every object', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      const ran: string[] = [];
      upsertEvent(state.storage.sql, { kind: 'a-kind-of-a-newer-version', subject: 'x', due: at(100) });
      upsertEvent(state.storage.sql, { kind: 'toString', subject: 'x', due: at(100) });
      await scheduler.schedule('cleanup', 'a', at(200));
      await scheduler.runDue(recording(ran));
      return { ran, left: dueEvents(state.storage.sql, at(10_000)) };
    });
    expect(seen.ran).toEqual(['a']);
    expect(seen.left).toEqual([]);
  });

  it('keeps an event its handler scheduled again, and sets the alarm for it', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'again', at(100));
      await consumed(state);
      await scheduler.runDue({ cleanup: (subject) => scheduler.schedule('cleanup', subject, at(4_000)) });
      return { left: dueEvents(state.storage.sql, at(10_000)), alarm: await state.storage.getAlarm() };
    });
    expect(seen.left).toEqual([{ kind: 'cleanup', subject: 'again', due: at(4_000) }]);
    expect(seen.alarm).toBe(at(4_000));
  });

  it('stops when a handler ends the table: nothing is read or set afterwards', async () => {
    const stub = untouchedStub();
    const seen = await runInDurableObject(stub, async (_table, state) => {
      createSchema(state.storage.sql);
      const scheduler = new Scheduler(state.storage, () => at(1_000));
      const ran: string[] = [];
      await scheduler.schedule('cleanup', 'first', at(100));
      await scheduler.schedule('cleanup', 'second', at(200));
      await scheduler.runDue({ cleanup: async (subject) => { ran.push(subject); await state.storage.deleteAll(); } });
      return { ran, alarm: await state.storage.getAlarm() };
    });
    expect(seen).toEqual({ ran: ['first'], alarm: null });
    expect(await tableNames(stub)).toEqual([]);
  });

  it('stops when a handler ends the table and then throws: the event is not written back', async () => {
    const stub = untouchedStub();
    const alarm = await runInDurableObject(stub, async (_table, state) => {
      createSchema(state.storage.sql);
      const scheduler = new Scheduler(state.storage, () => at(1_000));
      await scheduler.schedule('cleanup', 'first', at(100));
      await scheduler.runDue({ cleanup: async () => { await state.storage.deleteAll(); throw new Error('After it ended the table.'); } });
      return state.storage.getAlarm();
    });
    expect(alarm).toBeNull();
    expect(await tableNames(stub)).toEqual([]);
  });

  it('does nothing in an object that holds no table', async () => {
    const stub = untouchedStub();
    await runInDurableObject(stub, (_table, state) => new Scheduler(state.storage, () => at(1_000)).runDue(recording([])));
    expect(await tableNames(stub)).toEqual([]);
  });
});
