import { MAX_PLAYERS } from '../../../src/app/online/protocol/relay.ts';
import { randomBase32, randomBase64Url, sha256Hex } from '../table/codec.ts';
import { SECRET_BYTES, TABLE_CODE_BYTES } from '../table/limits.ts';
import { checkHostKey } from './hostKey.ts';
import { json, unavailable } from './responses.ts';

/**
 * `POST /api/tables`: makes a table for the host key and answers its code, its host secret and its
 * seats. The table's object keeps only digests of the code and the secret. The host key's registry
 * then names the table that was current for the key, which a new table ends (`superseded`).
 */
export async function createTable(request: Request, env: Cloudflare.Env): Promise<Response> {
  const check = await checkHostKey(request, env.HOST_KEY);
  if (!check.granted) return check.response;
  const code = randomBase32(TABLE_CODE_BYTES);
  const secret = randomBase64Url(SECRET_BYTES);
  try {
    const id = env.TABLES.idFromName(code);
    await env.TABLES.get(id).init({ secretHash: await sha256Hex(secret), codeHash: await sha256Hex(code), hostKeyHash: check.hostKeyHash });
    const previous = await env.HOSTS.getByName(check.hostKeyHash).replace(id.toString());
    if (previous !== null) await endPrevious(env, previous);
    return json(201, { code, secret, maxPlayers: MAX_PLAYERS });
  } catch {
    return unavailable();
  }
}

/** How often the old table is asked to end, and how long the Worker waits between the asks. */
const SUPERSEDE_ATTEMPTS = 2;
const SUPERSEDE_RETRY_MS = 100;

/** Durable Object infrastructure marks an object it found overloaded; asking it again only makes that worse. */
function isOverloaded(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'overloaded' in error && error.overloaded === true;
}

/**
 * Ends the table a new one replaces. The registry has moved on to the new table already, so nothing
 * would ever ask the old one again: a failed call is repeated once, on a new stub since an exception
 * can leave the first one broken, and not at all when the object is overloaded (Cloudflare's advice
 * for errors of Durable Objects). An old table that is gone needs no ending: `supersede` leaves it
 * alone and does not throw. If every attempt fails the new table stands and is answered all the
 * same: it is complete, and a second request would find the registry pointing at it, not at the
 * table that is still open. The old one then goes when its GM ends it or 24 hours after its GM left.
 */
async function endPrevious(env: Cloudflare.Env, tableId: string): Promise<void> {
  for (let attempt = 1; attempt <= SUPERSEDE_ATTEMPTS; attempt += 1) {
    try {
      await env.TABLES.get(env.TABLES.idFromString(tableId)).supersede();
      return;
    } catch (error) {
      if (attempt === SUPERSEDE_ATTEMPTS || isOverloaded(error)) return;
      await scheduler.wait(SUPERSEDE_RETRY_MS);
    }
  }
}
