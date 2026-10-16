import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { isInitialised } from './store.ts';

/**
 * Ends a table: closes every socket of the object with `code` and `reason`, deletes all of its
 * storage and cancels its alarm. `reason` is ASCII and at most 40 bytes (the name of the close code).
 * With a compatibility date of 2026-02-24 or later `deleteAll()` deletes the alarm too; asking for it
 * again keeps the end of a table independent of the date.
 */
export async function teardown(ctx: DurableObjectState, code: number, reason: string): Promise<void> {
  for (const socket of ctx.getWebSockets()) {
    try {
      socket.close(code, reason);
    } catch {
      // A socket that is closing already needs no second close, and must not keep the others open.
    }
  }
  await ctx.storage.deleteAll();
  await ctx.storage.deleteAlarm();
}

/**
 * A new table was made with the same host key: this one is over for everyone at it. An object that
 * holds no table (it ended already) is left as it is; nothing is created to delete it.
 */
export async function supersede(ctx: DurableObjectState): Promise<void> {
  if (isInitialised(ctx.storage.sql)) await teardown(ctx, CLOSE.superseded, 'superseded');
}

/** The table's 24 hours without a GM are over (the GM never came, or left): it ends as if the GM had ended it. */
export async function cleanup(ctx: DurableObjectState): Promise<void> {
  if (isInitialised(ctx.storage.sql)) await teardown(ctx, CLOSE.ended, 'ended');
}
