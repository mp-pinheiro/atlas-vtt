import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { randomBase32 } from '../src/table/codec.ts';
import { Scheduler } from '../src/table/scheduler.ts';
import { createSchema } from '../src/table/store.ts';
import type { TableObject } from '../src/table/TableObject.ts';

/**
 * The scheduler tests schedule at moments an hour or more from now on the real clock, because the
 * runtime moves an alarm set in the past to the present. The scheduler's own clock is passed to it
 * and stands wherever a test puts it.
 */
const BASE = Date.now() + 60 * 60 * 1000;
export const at = (offset: number): number => BASE + offset;

/** The object of a code nobody made a table for. */
export function untouchedStub(): DurableObjectStub<TableObject> {
  return env.TABLES.get(env.TABLES.idFromName(randomBase32(16)));
}

/** Runs `check` with a scheduler over a schema that holds no event yet, on a clock that stands at `now`. */
export function withScheduler<T>(now: number, check: (scheduler: Scheduler, state: DurableObjectState) => Promise<T>): Promise<T> {
  return runInDurableObject(untouchedStub(), (_table, state) => {
    createSchema(state.storage.sql);
    return check(new Scheduler(state.storage, () => now), state);
  });
}

/** The alarm that is running is consumed: inside the handler `getAlarm()` is null until something sets one. */
export function consumed(state: DurableObjectState): Promise<void> {
  return state.storage.deleteAlarm();
}
