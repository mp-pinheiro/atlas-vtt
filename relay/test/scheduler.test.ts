import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { GM_AWAY_MS } from '../src/table/limits.ts';
import { randomBase32, sha256Hex } from '../src/table/codec.ts';
import { Scheduler, type EventHandlers } from '../src/table/scheduler.ts';
import { createSchema, dueEvents, upsertEvent } from '../src/table/store.ts';
import type { TableObject } from '../src/table/TableObject.ts';
import { tableNames } from './helpers.ts';

afterEach(async () => {
  await reset();
});

/**
 * The tests schedule at moments an hour or more from now on the real clock, because the runtime
 * moves an alarm set in the past to the present. The scheduler's own clock is passed to it and
 * stands wherever a test puts it.
 */
const BASE = Date.now() + 60 * 60 * 1000;
const at = (offset: number): number => BASE + offset;

function untouchedStub(): DurableObjectStub<TableObject> {
  return env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
}

/** Runs `check` with a scheduler over a schema that holds no event yet, on a clock that stands at `now`. */
function withScheduler<T>(now: number, check: (scheduler: Scheduler, state: DurableObjectState) => Promise<T>): Promise<T> {
  return runInDurableObject(untouchedStub(), (_table, state) => {
    createSchema(state.storage.sql);
    return check(new Scheduler(state.storage, () => now), state);
  });
}

describe('schedule', () => {
  it('sets the alarm for the first event', async () => {
    const alarm = await withScheduler(0, async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'a', at(5_000));
      return state.storage.getAlarm();
    });
    expect(alarm).toBe(at(5_000));
  });

  it('brings the alarm forward for an earlier event, and leaves it for a later one: the earliest wins', async () => {
    const alarms = await withScheduler(0, async (scheduler, state) => {
      const seen: (number | null)[] = [];
      for (const [subject, due] of [['a', 5_000], ['b', 9_000], ['c', 2_000], ['d', 3_000]] as const) {
        await scheduler.schedule('cleanup', subject, at(due));
        seen.push(await state.storage.getAlarm());
      }
      return seen;
    });
    expect(alarms).toEqual([at(5_000), at(5_000), at(2_000), at(2_000)]);
  });

  it('replaces the event of the same kind and subject', async () => {
    const seen = await withScheduler(0, async (scheduler, state) => {
      await scheduler.schedule('cleanup', 'a', at(1_000));
      await scheduler.schedule('cleanup', 'a', at(8_000));
      return { events: dueEvents(state.storage.sql, at(100_000)), alarm: await state.storage.getAlarm() };
    });
    expect(seen.events).toEqual([{ kind: 'cleanup', subject: 'a', due: at(8_000) }]);
    // The alarm was set for the first moment and stays there: when it fires with nothing due it is set for what is left.
    expect(seen.alarm).toBe(at(1_000));
  });
});

describe('arm', () => {
  it('sets nothing in an object that holds no table, and creates nothing there', async () => {
    const stub = untouchedStub();
    const alarm = await runInDurableObject(stub, async (_table, state) => {
      await new Scheduler(state.storage, () => 0).arm();
      return state.storage.getAlarm();
    });
    expect(alarm).toBeNull();
    expect(await tableNames(stub)).toEqual([]);
  });

  it('sets nothing while no event is scheduled', async () => {
    expect(await withScheduler(0, async (scheduler, state) => { await scheduler.arm(); return state.storage.getAlarm(); })).toBeNull();
  });

  it('reads the alarm first: one that is set earlier than the first event stays', async () => {
    const alarm = await withScheduler(0, async (scheduler, state) => {
      await state.storage.setAlarm(at(1_000));
      upsertEvent(state.storage.sql, { kind: 'cleanup', subject: 'a', due: at(7_000) });
      await scheduler.arm();
      return state.storage.getAlarm();
    });
    expect(alarm).toBe(at(1_000));
  });

  it('moves an alarm that is set later than the first event', async () => {
    const alarm = await withScheduler(0, async (scheduler, state) => {
      await state.storage.setAlarm(at(90_000));
      upsertEvent(state.storage.sql, { kind: 'cleanup', subject: 'a', due: at(7_000) });
      await scheduler.arm();
      return state.storage.getAlarm();
    });
    expect(alarm).toBe(at(7_000));
  });
});

describe('the constructor of a table object', () => {
  async function madeStub(): Promise<{ stub: DurableObjectStub<TableObject>; due: number }> {
    const stub = untouchedStub();
    const hash = await sha256Hex('x');
    await stub.init({ secretHash: hash, codeHash: hash, hostKeyHash: hash });
    const due = await runInDurableObject(stub, async (_table, state) => (await state.storage.getAlarm()) ?? 0);
    return { stub, due };
  }

  it('sets the alarm again for the earliest event when an alarm was lost', async () => {
    const { stub, due } = await madeStub();
    expect(due).toBeGreaterThan(Date.now() + GM_AWAY_MS - 60_000);
    await runInDurableObject(stub, (_table, state) => state.storage.deleteAlarm());
    await evictDurableObject(stub);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(due);
  });

  it('checks the alarm before it sets one: an alarm set earlier stays', async () => {
    const { stub } = await madeStub();
    const earlier = Date.now() + 60 * 60 * 1000;
    await runInDurableObject(stub, (_table, state) => state.storage.setAlarm(earlier));
    await evictDurableObject(stub);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(earlier);
  });

  it('leaves the alarm where it is when it wakes', async () => {
    const { stub, due } = await madeStub();
    await evictDurableObject(stub);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(due);
  });
});

describe('runDue', () => {
  const recording = (ran: string[]): EventHandlers => ({ cleanup: (subject) => { ran.push(subject); return Promise.resolve(); } });

  /** The alarm that is running is consumed: inside the handler `getAlarm()` is null until something sets one. */
  const consumed = (state: DurableObjectState): Promise<void> => state.storage.deleteAlarm();

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

  it('drops an event whose handler throws, and runs the others, without throwing', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      const ran: string[] = [];
      await scheduler.schedule('cleanup', 'a', at(100));
      await scheduler.schedule('cleanup', 'bad', at(200));
      await scheduler.schedule('cleanup', 'c', at(300));
      await scheduler.runDue({ cleanup: (subject) => (subject === 'bad' ? Promise.reject(new Error('A bad row.')) : recording(ran).cleanup(subject)) });
      return { ran, left: dueEvents(state.storage.sql, at(10_000)) };
    });
    expect(seen.ran).toEqual(['a', 'c']);
    expect(seen.left).toEqual([]);
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

  it('does nothing in an object that holds no table', async () => {
    const stub = untouchedStub();
    await runInDurableObject(stub, (_table, state) => new Scheduler(state.storage, () => at(1_000)).runDue(recording([])));
    expect(await tableNames(stub)).toEqual([]);
  });
});

describe('cancel', () => {
  it('removes an event so it does not run when the alarm fires, and the alarm is set for what is left', async () => {
    const seen = await withScheduler(at(1_000), async (scheduler, state) => {
      const ran: string[] = [];
      await scheduler.schedule('cleanup', 'cancelled', at(100));
      await scheduler.schedule('cleanup', 'kept', at(5_000));
      scheduler.cancel('cleanup', 'cancelled');
      await state.storage.deleteAlarm();
      await scheduler.runDue({ cleanup: (subject) => { ran.push(subject); return Promise.resolve(); } });
      return { ran, alarm: await state.storage.getAlarm() };
    });
    expect(seen).toEqual({ ran: [], alarm: at(5_000) });
  });
});

describe('the alarm of a table object', () => {
  it('runs the due events on the table\'s clock and sets the alarm for the next', async () => {
    const stub = untouchedStub();
    const hash = await sha256Hex('x');
    await stub.init({ secretHash: hash, codeHash: hash, hostKeyHash: hash });
    // The alarm fires early on the real clock: nothing is due, so the table stays and the alarm stays set for its end.
    const before = await runInDurableObject(stub, (_table, state) => state.storage.getAlarm());
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.isInitialised()).toBe(true);
    expect(await runInDurableObject(stub, (_table, state) => state.storage.getAlarm())).toBe(before);
  });
});
