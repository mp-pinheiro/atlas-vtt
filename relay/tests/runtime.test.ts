import { describe, expect, it } from 'vitest';
import { SELF, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { sha256 } from '../src/credentials.ts';
import { HostRegistry } from '../src/HostRegistry.ts';

describe('relay Worker routes', () => {
  it('requires host authorization and serves the fixed self-hosted account', async () => {
    const denied = await SELF.fetch('https://relay.test/api/me');
    expect(denied.status).toBe(401);
    const response = await SELF.fetch('https://relay.test/api/me', { headers: { authorization: `Bearer ${env.HOST_KEY}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: { id: 'fairfruit', handle: 'fairfruit', name: 'Fairfruit' }, access: { plan: 'self-hosted', maxPlayers: 12, endsAt: null } });
  });

  it('creates a table and never persists the returned code or secret', async () => {
    const response = await SELF.fetch('https://relay.test/api/tables', { method: 'POST', headers: { authorization: `Bearer ${env.HOST_KEY}` } });
    expect(response.status).toBe(201);
    const created = await response.json() as { code: string; secret: string; maxPlayers: number };
    expect(created).toEqual({ code: expect.stringMatching(/^[a-z2-7]{26}$/u), secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u), maxPlayers: 12 });
    const host = env.HOSTS.get(env.HOSTS.idFromName('host'));
    const hostValues = await runInDurableObject(host, (_instance: HostRegistry, state) => state.storage.sql.exec<{ value: string }>('SELECT value FROM meta').toArray().map((row) => row.value));
    expect(hostValues.join('\n')).not.toContain(created.code);
    expect(hostValues.join('\n')).not.toContain(created.secret);
    const idName = await sha256(created.code);
    const table = env.TABLES.get(env.TABLES.idFromName(idName));
    const stored = await runInDurableObject(table, (_instance, state) => state.storage.sql.exec('SELECT * FROM meta').toArray());
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(created.code);
    expect(serialized).not.toContain(created.secret);
  });

  it('returns empty responses for discard-only endpoints without parsing the body', async () => {
    const report = await SELF.fetch('https://relay.test/api/reports', { method: 'POST', body: '{broken' });
    const feedback = await SELF.fetch('https://relay.test/api/feedback', { method: 'POST', body: '{broken' });
    const seat = await SELF.fetch('https://relay.test/__atlas-online-seat', { method: 'POST', body: '{broken' });
    expect([report.status, feedback.status, seat.status]).toEqual([204, 204, 204]);
    expect(await report.text()).toBe('');
    expect(await feedback.text()).toBe('');
    expect(await seat.text()).toBe('');
  });
});
