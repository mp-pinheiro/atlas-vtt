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

/** Ends the table a new one replaces. The old one may be gone already (ended, cleaned up), which is as good. */
async function endPrevious(env: Cloudflare.Env, tableId: string): Promise<void> {
  try {
    await env.TABLES.get(env.TABLES.idFromString(tableId)).supersede();
  } catch {
    // Nothing to end: the new table stands either way.
  }
}
