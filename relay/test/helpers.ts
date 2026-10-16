import { listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import worker from '../src/index.ts';
import type { TableObject } from '../src/table/TableObject.ts';
import { TEST_HOST_KEY } from './fixtures/hostKey.ts';

/** What `POST /api/tables` answers with, as the companion reads it. */
export interface CreatedTableAnswer {
  readonly code: string;
  readonly secret: string;
  readonly maxPlayers: number;
}

function isCreated(value: unknown): value is CreatedTableAnswer {
  if (typeof value !== 'object' || value === null) return false;
  return 'code' in value && typeof value.code === 'string' && 'secret' in value && typeof value.secret === 'string' && 'maxPlayers' in value && typeof value.maxPlayers === 'number';
}

/** The header the companion sends: the host key as a Bearer token. */
export function authHeaders(hostKey: string = TEST_HOST_KEY): Record<string, string> {
  return { Authorization: `Bearer ${hostKey}` };
}

/** A request to the relay's Worker, as the runtime delivers it to the main Worker. */
export function relayFetch(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`https://relay.example${path}`, init);
}

/** Makes a table the way the companion does, at a relay whose host key is `hostKey`. */
export async function createTable(hostKey: string = TEST_HOST_KEY): Promise<CreatedTableAnswer> {
  const response = await fetchWith(envWithHostKey(hostKey), '/api/tables', { method: 'POST', headers: authHeaders(hostKey) });
  const body = await response.json<unknown>();
  if (response.status !== 201 || !isCreated(body)) throw new Error(`A table was expected, the relay answered ${response.status}.`);
  return body;
}

/** The object of a table, by its code. */
export function tableStub(code: string): DurableObjectStub<TableObject> {
  return env.TABLES.get(env.TABLES.idFromName(code));
}

/** The bindings of the test relay with the Worker secret `HOST_KEY` set to `hostKey`, or not set at all. */
export function envWithHostKey(hostKey: string | undefined): Cloudflare.Env {
  const bindings = { TABLES: env.TABLES, HOSTS: env.HOSTS, ASSETS: env.ASSETS };
  return hostKey === undefined ? bindings : { ...bindings, HOST_KEY: hostKey };
}

/** A request answered by the Worker's handler with the bindings given, the way the runtime would with another secret. */
export async function callWorker(request: Request, environment: Cloudflare.Env): Promise<Response> {
  return await worker.fetch(request, environment);
}

export function fetchWith(environment: Cloudflare.Env, path: string, init?: RequestInit): Promise<Response> {
  return callWorker(new Request(`https://relay.example${path}`, init), environment);
}

/** The test relay's bindings with a `TABLES` namespace whose stubs fail some of the calls to `supersede`, and the count of those calls. */
export interface FlakySupersede {
  readonly environment: Cloudflare.Env;
  supersedeCalls(): number;
}

/**
 * The calls fail on the Worker's side of the stub, the way a Durable Object call fails for the
 * Worker (an error thrown inside the object would also be reported to Vitest as an unhandled
 * rejection). The first `failures` calls to `supersede`, of any table, throw `error`; the rest reach the object.
 */
export function envWithFlakySupersede(failures: number, error: Error): FlakySupersede {
  let calls = 0;
  const flaky = (stub: DurableObjectStub<TableObject>): DurableObjectStub<TableObject> =>
    new Proxy(stub, {
      get(target, property): unknown {
        if (property === 'supersede') {
          calls += 1;
          return calls <= failures ? () => Promise.reject(error) : () => target.supersede();
        }
        return Reflect.get(target, property);
      },
    });
  const tables = new Proxy(env.TABLES, {
    get(target, property): unknown {
      if (property === 'get') return (id: DurableObjectId): DurableObjectStub<TableObject> => flaky(target.get(id));
      const member: unknown = Reflect.get(target, property);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
  return { environment: { ...envWithHostKey(TEST_HOST_KEY), TABLES: tables }, supersedeCalls: () => calls };
}

/** How many objects a namespace has made so far. They outlive `reset()`, so tests compare counts before and after. */
export async function objectCount<T extends Rpc.DurableObjectBranded | undefined>(namespace: DurableObjectNamespace<T>): Promise<number> {
  return (await listDurableObjectIds(namespace)).length;
}

/** A row of a query over a table's storage; the tests store no blobs. */
export type Row = Readonly<Record<string, string | number | null>>;

function plain(value: SqlStorageValue): string | number | null {
  if (value instanceof ArrayBuffer) throw new Error('A blob was not expected.');
  return value;
}

/** The rows a query returns in a table's storage. */
export async function sqlRows(stub: DurableObjectStub<TableObject>, query: string, ...bindings: (string | number)[]): Promise<Row[]> {
  const rows = await runInDurableObject(stub, (_table, state) => state.storage.sql.exec(query, ...bindings).toArray());
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, plain(value)])));
}

/** The names of the tables in a table object's storage; the runtime's own tables (`_cf_…`) are left out. */
export async function tableNames(stub: DurableObjectStub<TableObject>): Promise<string[]> {
  const rows = await sqlRows(stub, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return rows.map((row) => String(row.name)).filter((name) => !name.startsWith('_cf_'));
}

/**
 * The message of the error `action` throws on the table object, or null when it throws none. The
 * action runs inside the object: an error thrown through a stub is also reported to Vitest as an
 * unhandled rejection of the object, which fails the run.
 */
export function failureOf(stub: DurableObjectStub<TableObject>, action: (table: TableObject) => Promise<unknown>): Promise<string | null> {
  return runInDurableObject(stub, async (table) => {
    try {
      await action(table);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

/** How the other end of a socket was closed. */
export interface Closed {
  readonly code: number;
  readonly reason: string;
}

/** Hibernatable sockets accepted by the table's object, and the closings their other ends will see. */
export async function acceptSockets(stub: DurableObjectStub<TableObject>, count: number): Promise<Promise<Closed>[]> {
  const closings: Promise<Closed>[] = [];
  await runInDurableObject(stub, (_table, state) => {
    for (let index = 0; index < count; index += 1) {
      const pair = new WebSocketPair();
      state.acceptWebSocket(pair[1]);
      pair[0].accept();
      closings.push(new Promise((resolve) => pair[0].addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }))));
    }
  });
  return closings;
}
