// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTable } from '../../../../src/app/online/gm/createTable.ts';
import { readCreated } from '../../../../src/app/online/gm/createdTable.ts';
import type { HttpRequest } from '../../../../src/app/online/gm/host/http.ts';
const TABLE = { code: 'b'.repeat(26), secret: 'n'.repeat(43), maxPlayers: 12 };
describe('host table creation', () => {
  it('accepts only a valid relay table response', () => {
    expect(readCreated(201, TABLE)).toEqual(TABLE);
    expect(readCreated(201, { ...TABLE, maxPlayers: 2 })).toMatchObject({ maxPlayers: 2 });
    expect(readCreated(201, { code: 'short', secret: TABLE.secret })).toBe('The relay answered with something that is no table.');
  });
  it('reports host-key and relay refusals without account-service semantics', () => {
    expect(readCreated(401, { reason: 'unauthorized' })).toBe('The relay refused the host key. Check it in Online settings.');
    expect(readCreated(403, { reason: 'forbidden' })).toBe('This host key cannot create tables.');
    expect(readCreated(503, { reason: 'not-configured' })).toBe('This relay is not configured to host tables.');
    expect(readCreated(500, null)).toBe('The relay could not create a table (500).');
  });
  it('sends only the host bearer to the configured relay', async () => {
    const requests: HttpRequest[] = [];
    const created = await createTable((request) => { requests.push(request); return Promise.resolve({ status: 201, json: TABLE }); }, 'https://relay.example', 'host-key');
    expect(created).toMatchObject({ code: TABLE.code });
    expect(requests).toEqual([{ url: 'https://relay.example/api/tables', method: 'POST', authorization: 'Bearer host-key' }]);
    expect(await createTable(() => Promise.reject(new Error('offline')), 'https://relay.example', 'host-key')).toEqual({ status: 0, message: 'The server could not be reached.' });
  });
});
