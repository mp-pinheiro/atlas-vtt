import { reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { FEEDBACK_PATH, REPORTS_PATH } from '../../src/app/online/protocol/diagnostics.ts';
import { MAX_PLAYERS, SEAT_PATH, SECRET_PATTERN, TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { sha256Hex } from '../src/table/codec.ts';
import { OTHER_HOST_KEY, TEST_HOST_KEY } from './fixtures/hostKey.ts';
import { authHeaders, callWorker, createTable, envWithHostKey, fetchWith, objectCount, relayFetch, sqlRows, tableStub } from './helpers.ts';

afterEach(async () => {
  await reset();
});

/** The status and the headers every JSON answer of the relay carries, and its body. */
async function expectJson(response: Response, status: number, body: unknown): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(body);
}

/** Runs `action` and says whether it made any table or host registry object. */
async function madeObjects(action: () => Promise<unknown>): Promise<boolean> {
  const before = [await objectCount(env.TABLES), await objectCount(env.HOSTS)];
  await action();
  return before[0] !== (await objectCount(env.TABLES)) || before[1] !== (await objectCount(env.HOSTS));
}

describe('POST /api/tables', () => {
  it('creates a table and answers 201 with its code, secret and seats', async () => {
    const response = await relayFetch('/api/tables', { method: 'POST', headers: authHeaders() });
    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(['code', 'maxPlayers', 'secret']);
    // The companion takes a code of TABLE_CODE_PATTERN and a secret of 32 characters or more (createdTable.ts: `secret.length < 32`).
    expect(body.code).toMatch(TABLE_CODE_PATTERN);
    expect(String(body.secret).length).toBeGreaterThanOrEqual(32);
    expect(body.secret).toMatch(SECRET_PATTERN);
    expect(body.maxPlayers).toBe(MAX_PLAYERS);
  });

  it('makes every table its own: another code and another secret each time', async () => {
    const tables = [await createTable(), await createTable(), await createTable()];
    expect(new Set(tables.map((table) => table.code)).size).toBe(3);
    expect(new Set(tables.map((table) => table.secret)).size).toBe(3);
  });

  it('keeps digests of the code, the secret and the host key in the table, and none of the three themselves', async () => {
    const { code, secret } = await createTable();
    const rows = await sqlRows(tableStub(code), 'SELECT key, value FROM meta ORDER BY key');
    const meta = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
    expect(meta.secret_hash).toBe(await sha256Hex(secret));
    expect(meta.code_hash).toBe(await sha256Hex(code));
    expect(meta.host_key_hash).toBe(await sha256Hex(TEST_HOST_KEY));
    const everything = JSON.stringify(await sqlRows(tableStub(code), 'SELECT * FROM meta'));
    for (const plain of [code, secret, TEST_HOST_KEY]) expect(everything).not.toContain(plain);
  });

  it('answers a request that carries a body without reading it', async () => {
    const headers = { ...authHeaders(), 'Content-Type': 'application/json' };
    const request = new Request('https://relay.example/api/tables', { method: 'POST', headers, body: '{"anything":true}' });
    const response = await callWorker(request, envWithHostKey(TEST_HOST_KEY));
    expect(response.status).toBe(201);
    expect(request.bodyUsed).toBe(false);
  });

  it.each([
    ['no Authorization header', {}],
    ['another scheme', { Authorization: `Basic ${TEST_HOST_KEY}` }],
    ['an empty token', { Authorization: 'Bearer ' }],
    ['a wrong key', authHeaders(OTHER_HOST_KEY)],
    ['the key with a character added', authHeaders(`${TEST_HOST_KEY}x`)],
    ['the key with a character missing', authHeaders(TEST_HOST_KEY.slice(0, -1))],
    ['the key in another case', authHeaders(TEST_HOST_KEY.toUpperCase())],
  ])('refuses %s with 401 and makes no table', async (_name, headers) => {
    let response: Response | undefined;
    expect(await madeObjects(async () => { response = await relayFetch('/api/tables', { method: 'POST', headers }); })).toBe(false);
    await expectJson(response ?? new Response(null, { status: 0 }), 401, { error: 'invalid-host-key' });
  });

  it('takes the Bearer scheme in any case', async () => {
    const response = await relayFetch('/api/tables', { method: 'POST', headers: { Authorization: `bearer ${TEST_HOST_KEY}` } });
    expect(response.status).toBe(201);
  });

  it.each([
    ['unset', undefined],
    ['shorter than 16 characters', 'short-key'],
    ['not of the protocol\'s secret form', 'a key with spaces and symbols!'],
  ])('answers 503 not-configured when HOST_KEY is %s, whatever the request carries', async (_name, hostKey) => {
    const environment = envWithHostKey(hostKey);
    expect(await madeObjects(async () => {
      for (const headers of [authHeaders(), {}, authHeaders(OTHER_HOST_KEY)]) {
        await expectJson(await fetchWith(environment, '/api/tables', { method: 'POST', headers }), 503, { error: 'not-configured' });
      }
    })).toBe(false);
  });

  it('answers 503 unavailable when a Durable Object fails', async () => {
    const failing = new Proxy(env.TABLES, {
      get(target, property): unknown {
        if (property === 'get') return () => { throw new Error('The object could not be reached.'); };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const response = await fetchWith({ ...envWithHostKey(TEST_HOST_KEY), TABLES: failing }, '/api/tables', { method: 'POST', headers: authHeaders() });
    await expectJson(response, 503, { error: 'unavailable' });
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('answers %s with 405 and Allow: POST, and makes no table', async (method) => {
    let response: Response | undefined;
    expect(await madeObjects(async () => { response = await relayFetch('/api/tables', { method, headers: authHeaders() }); })).toBe(false);
    expect(response?.status).toBe(405);
    expect(response?.headers.get('Allow')).toBe('POST');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    if (method !== 'HEAD') expect(await response?.json()).toEqual({ error: 'method-not-allowed' });
  });
});

describe('GET /api/me', () => {
  it('names an account after the relay and gives access for a full table with no end date', async () => {
    // The shape RelayAccount.me() reads (relayAccount.ts): string id, handle and name; string plan, integer maxPlayers >= 1, endsAt a number or null.
    await expectJson(await relayFetch('/api/me', { headers: authHeaders() }), 200, {
      account: { id: 'relay', handle: 'relay.example', name: 'relay.example' },
      access: { plan: 'host', maxPlayers: 12, endsAt: null },
    });
  });

  it('names the host the request came to', async () => {
    const request = new Request('https://play.example.org:8443/api/me', { headers: authHeaders() });
    const body = await (await callWorker(request, envWithHostKey(TEST_HOST_KEY))).json<{ account: { handle: string; name: string } }>();
    expect(body.account.handle).toBe('play.example.org:8443');
    expect(body.account.name).toBe('play.example.org:8443');
  });

  it.each([
    ['no Authorization header', {}],
    ['a wrong key', authHeaders(OTHER_HOST_KEY)],
    ['another scheme', { Authorization: `Token ${TEST_HOST_KEY}` }],
  ])('refuses %s with 401', async (_name, headers) => {
    await expectJson(await relayFetch('/api/me', { headers }), 401, { error: 'invalid-host-key' });
  });

  it.each([
    ['unset', undefined],
    ['not of the protocol\'s secret form', 'short'],
  ])('answers 503 not-configured when HOST_KEY is %s, before it looks at the request', async (_name, hostKey) => {
    for (const headers of [authHeaders(), {}]) {
      await expectJson(await fetchWith(envWithHostKey(hostKey), '/api/me', { headers }), 503, { error: 'not-configured' });
    }
  });

  it('keeps nothing: asking creates no object', async () => {
    expect(await madeObjects(() => relayFetch('/api/me', { headers: authHeaders() }))).toBe(false);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('answers %s with 405 and Allow: GET', async (method) => {
    const response = await relayFetch('/api/me', { method, headers: authHeaders() });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'method-not-allowed' });
  });
});

describe('the seat path', () => {
  it.each(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])('answers %s with 204 and no body', async (method) => {
    const response = await relayFetch(SEAT_PATH, { method });
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('answers without reading the request', async () => {
    const request = new Request(`https://relay.example${SEAT_PATH}`, { method: 'POST', body: 'unread' });
    const response = await callWorker(request, envWithHostKey(TEST_HOST_KEY));
    expect(response.status).toBe(204);
    expect(request.bodyUsed).toBe(false);
  });

  it('is the one path: a path below it is left to the assets layer', async () => {
    const response = await relayFetch(`${SEAT_PATH}/more`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).not.toBe('application/json');
  });
});

describe.each([REPORTS_PATH, FEEDBACK_PATH])('POST %s', (path) => {
  it('answers 204 without reading the body, and keeps nothing', async () => {
    const request = new Request(`https://relay.example${path}`, { method: 'POST', body: JSON.stringify({ message: 'a report' }) });
    let response: Response | undefined;
    expect(await madeObjects(async () => { response = await callWorker(request, envWithHostKey(TEST_HOST_KEY)); })).toBe(false);
    expect(response?.status).toBe(204);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(await response?.text()).toBe('');
    expect(request.bodyUsed).toBe(false);
  });

  it('asks for no host key', async () => {
    expect((await relayFetch(path, { method: 'POST' })).status).toBe(204);
    expect((await relayFetch(path, { method: 'POST', headers: authHeaders(OTHER_HOST_KEY) })).status).toBe(204);
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('answers %s with 405 and Allow: POST', async (method) => {
    const response = await relayFetch(path, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(await response.json()).toEqual({ error: 'method-not-allowed' });
  });
});

describe('everything else under /api/', () => {
  // The socket and stream routes of a table come with the table object's side of them: until then they are no route.
  it.each([
    '/api/',
    '/api/unknown',
    '/api/tables/',
    '/api/tables/x',
    '/api/tables/abcdefghijklmnopqrstuvwxyz/socket',
    '/api/tables/abcdefghijklmnopqrstuvwxyz/stream',
    '/api/tables/abcdefghijklmnopqrstuvwxyz/stream/send',
    '/api/me/',
    '/api/ME',
    '/api/reports/more',
  ])('answers %s with 404 not-found for every method', async (path) => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      await expectJson(await relayFetch(path, { method, headers: authHeaders() }), 404, { error: 'not-found' });
    }
  });
});

describe('the player client\'s files', () => {
  it('are served by the assets layer', async () => {
    const response = await env.ASSETS.fetch('https://relay.example/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Atlas relay test page');
  });

  it('are served for a path that reaches the Worker too', async () => {
    const response = await relayFetch('/app.css');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/css');
    expect(await response.text()).toContain('.player');
  });

  it('leave a path without a file to the assets layer\'s 404', async () => {
    const response = await relayFetch('/no-such-file.txt');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).not.toBe('application/json');
  });
});
