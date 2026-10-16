import { MAX_PLAYERS } from '../../../src/app/online/protocol/relay.ts';
import { checkHostKey } from './hostKey.ts';
import { json } from './responses.ts';

/**
 * `GET /api/me`: the companion's check of the host key. The answer has the shape its
 * `RelayAccount.me()` reads: an account named after the relay (the host the request came to), and
 * access for a full table with no end date.
 */
export async function account(request: Request, env: Cloudflare.Env): Promise<Response> {
  const check = await checkHostKey(request, env.HOST_KEY);
  if (!check.granted) return check.response;
  const { host } = new URL(request.url);
  return json(200, {
    account: { id: 'relay', handle: host, name: host },
    access: { plan: 'host', maxPlayers: MAX_PLAYERS, endsAt: null },
  });
}
