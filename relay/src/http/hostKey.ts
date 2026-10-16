import { SECRET_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { sameHash, sha256Hex } from '../table/codec.ts';
import { json } from './responses.ts';

/** The result of checking a request for the host key: the key's digest, or the answer that refuses it. */
type HostCheck = { readonly granted: true; readonly hostKeyHash: string } | { readonly granted: false; readonly response: Response };

const BEARER = /^Bearer +(.+)$/i;

/**
 * Checks `Authorization: Bearer <key>` against the Worker's `HOST_KEY`. Without a key of the
 * protocol's secret form the relay is not configured (503), and anything but the key is refused
 * (401). The key is never compared as text: both sides are hashed and the digests compared in
 * constant time, so the answer's timing says nothing about how much of a guess was right.
 */
export async function checkHostKey(request: Request, hostKey: string | undefined): Promise<HostCheck> {
  if (hostKey === undefined || !SECRET_PATTERN.test(hostKey)) return { granted: false, response: json(503, { error: 'not-configured' }) };
  const presented = BEARER.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  const [expected, given] = await Promise.all([sha256Hex(hostKey), sha256Hex(presented)]);
  if (!sameHash(given, expected)) return { granted: false, response: json(401, { error: 'invalid-host-key' }) };
  return { granted: true, hostKeyHash: expected };
}
