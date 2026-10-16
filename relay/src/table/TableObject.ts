import { DurableObject } from 'cloudflare:workers';
import { GM_AWAY_MS } from './limits.ts';
import { cleanup, supersede } from './lifecycle.ts';
import { Scheduler } from './scheduler.ts';
import { createSchema, isInitialised, setMeta, upsertEvent } from './store.ts';

/** The relay's clock. A public field of the object so a test can move time on (`runInDurableObject`). */
export interface Clock {
  now(): number;
}

/** What a new table keeps: SHA-256 digests (64 lowercase hex characters) of its host secret, its code and the host key it was made with. Never the values. */
export interface TableInit {
  readonly secretHash: string;
  readonly codeHash: string;
  readonly hostKeyHash: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * One table of the relay: a Durable Object named by the table's code. This part holds the table's
 * life (made by `init`, ended by `supersede` or by the alarm); the sockets and the rules that
 * route them come with the fetch handler and the hibernation handlers.
 */
export class TableObject extends DurableObject {
  clock: Clock = { now: () => Date.now() };
  private readonly scheduler: Scheduler;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.scheduler = new Scheduler(ctx.storage, () => this.clock.now());
    // An alarm lost in a crash is set again from the events table; an alarm set already is never moved later.
    void ctx.blockConcurrencyWhile(() => this.scheduler.arm());
  }

  /**
   * Makes the table: creates its schema and schedules its end 24 hours from now, so a table whose
   * GM never connects goes by the same rule as one whose GM left. Throws if a table exists here.
   */
  async init(input: TableInit): Promise<void> {
    const sql = this.ctx.storage.sql;
    if (![input.secretHash, input.codeHash, input.hostKeyHash].every((hash) => HASH_PATTERN.test(hash))) throw new Error('A table keeps SHA-256 digests only.');
    if (isInitialised(sql)) throw new Error('This table exists already.');
    const createdAt = this.clock.now();
    this.ctx.storage.transactionSync(() => {
      createSchema(sql);
      setMeta(sql, 'secret_hash', input.secretHash);
      setMeta(sql, 'code_hash', input.codeHash);
      setMeta(sql, 'host_key_hash', input.hostKeyHash);
      setMeta(sql, 'created_at', String(createdAt));
      upsertEvent(sql, { kind: 'cleanup', subject: 'table', due: createdAt + GM_AWAY_MS });
    });
    await this.scheduler.arm();
  }

  /** Whether a table was made in this object; false after it ended, and for any code nobody made a table for. */
  isInitialised(): boolean {
    return isInitialised(this.ctx.storage.sql);
  }

  /** A new table was made with the same host key: closes every socket with `superseded` and deletes everything. */
  async supersede(): Promise<void> {
    await supersede(this.ctx);
  }

  override async alarm(): Promise<void> {
    await this.scheduler.runDue({ cleanup: () => cleanup(this.ctx) });
  }
}
