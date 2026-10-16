import { TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { equalDigest, sha256 } from './credentials.ts';

export { Table } from './Table.ts';
export { HostRegistry } from './HostRegistry.ts';

export interface Env {
  readonly HOST_KEY?: string;
  readonly TABLES: DurableObjectNamespace;
  readonly HOSTS: DurableObjectNamespace;
  readonly ASSETS: Fetcher;
}

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const empty = (status: number): Response => new Response(null, { status });

async function authorized(request: Request, configured: string | undefined): Promise<boolean> {
  if (!configured) return false;
  const supplied = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!supplied) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(configured)]);
  return equalDigest(a, b);
}

async function tableStub(env: Env, code: string): Promise<DurableObjectStub> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  const name = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return env.TABLES.get(env.TABLES.idFromName(name));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/__atlas-online-seat') return empty(204);
    if (path === '/api/reports' || path === '/api/feedback') return empty(204);
    if (path === '/api/me') {
      if (request.method !== 'GET') return empty(405);
      if (!env.HOST_KEY) return json({ reason: 'not-configured' }, 503);
      if (!await authorized(request, env.HOST_KEY)) return json({ reason: 'unauthorized' }, 401);
      return json({ account: { id: 'fairfruit', handle: 'fairfruit', name: 'Fairfruit' }, access: { plan: 'self-hosted', maxPlayers: 12, endsAt: null } });
    }
    if (path === '/api/tables') {
      if (request.method !== 'POST') return empty(405);
      if (!env.HOST_KEY) return json({ reason: 'not-configured' }, 503);
      if (!await authorized(request, env.HOST_KEY)) return json({ reason: 'unauthorized' }, 401);
      return env.HOSTS.get(env.HOSTS.idFromName('host')).fetch(new Request('https://host/create', { method: 'POST', headers: { authorization: request.headers.get('authorization')! } }));
    }
    const socketMatch = path.match(/^\/api\/tables\/([^/]+)\/socket$/);
    if (socketMatch) {
      if (request.method !== 'GET') return empty(405);
      if (!TABLE_CODE_PATTERN.test(socketMatch[1]!)) return empty(404);
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return empty(426);
      return (await tableStub(env, socketMatch[1]!)).fetch(request);
    }
    const streamMatch = path.match(/^\/api\/tables\/([^/]+)\/stream(?:\/send)?$/);
    if (streamMatch) {
      if (!TABLE_CODE_PATTERN.test(streamMatch[1]!)) return empty(404);
      if (request.method !== 'POST') return empty(405);
      return (await tableStub(env, streamMatch[1]!)).fetch(request);
    }
    if (path.startsWith('/api/')) return empty(404);
    if (request.method !== 'GET' && request.method !== 'HEAD') return empty(405);
    return env.ASSETS.fetch(request);
  },
};
