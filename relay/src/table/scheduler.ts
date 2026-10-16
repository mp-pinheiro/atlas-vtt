import { cancelEvent, dueEvents, earliestDue, isInitialised, removeEvent, upsertEvent, type EventKind } from './store.ts';

/** What runs when an event of a kind falls due; `subject` is what the event was scheduled for. */
export type EventHandlers = Readonly<Record<EventKind, (subject: string) => Promise<void>>>;

function isHandled(handlers: EventHandlers, kind: string): kind is EventKind {
  return Object.hasOwn(handlers, kind);
}

/**
 * Many scheduled actions on the one alarm a Durable Object has ("Each Durable Object is able to
 * schedule a single alarm at a time by calling `setAlarm()`"). The events table holds every future
 * action; the alarm is always at or before the earliest of them, and `runDue` runs what is due and
 * sets the alarm for what is left.
 */
export class Scheduler {
  private readonly storage: DurableObjectStorage;
  private readonly now: () => number;

  constructor(storage: DurableObjectStorage, now: () => number) {
    this.storage = storage;
    this.now = now;
  }

  /** Schedules an action, replacing the one of the same kind and subject, and brings the alarm forward if it is the earliest. */
  async schedule(kind: EventKind, subject: string, due: number): Promise<void> {
    upsertEvent(this.storage.sql, { kind, subject, due });
    await this.arm();
  }

  /** Cancels an action. The alarm stays where it is; if it fires with nothing due it is set for what is left. */
  cancel(kind: EventKind, subject: string): void {
    cancelEvent(this.storage.sql, kind, subject);
  }

  /**
   * Sets the alarm for the earliest event, unless an alarm at or before it is set already. The
   * alarm is read first, as Cloudflare's documentation asks of anything that sets an alarm in the
   * constructor: the constructor of an object that wakes for an alarm runs before the alarm handler.
   */
  async arm(): Promise<void> {
    if (!isInitialised(this.storage.sql)) return;
    const next = earliestDue(this.storage.sql);
    if (next === null) return;
    const current = await this.storage.getAlarm();
    if (current === null || next < current) await this.storage.setAlarm(next);
  }

  /**
   * Runs the events that are due, in order, and sets the alarm for the earliest one left. An event
   * whose handler throws is dropped like one that ran: one bad row must neither stop the others nor
   * make the alarm throw, which the runtime would retry. A handler that ends the table (it deletes
   * the storage) ends the run; there is nothing left to run or to arm.
   */
  async runDue(handlers: EventHandlers): Promise<void> {
    const sql = this.storage.sql;
    if (!isInitialised(sql)) return;
    for (const event of dueEvents(sql, this.now())) {
      try {
        if (isHandled(handlers, event.kind)) await handlers[event.kind](event.subject);
      } catch {
        // Dropped with the rows that ran: see above. Nothing is logged, since a subject may name a person.
      }
      if (!isInitialised(sql)) return;
      removeEvent(sql, event);
    }
    await this.arm();
  }
}
