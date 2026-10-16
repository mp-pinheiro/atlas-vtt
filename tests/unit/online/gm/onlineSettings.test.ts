import { describe, expect, it } from 'vitest';
import { HostControl } from '../../../../src/app/online/gm/host/HostControl.ts';
import type { HostKeyStore } from '../../../../src/app/online/gm/host/hostKeyStore.ts';
import { DEFAULT_SETTINGS, readSettings } from '../../../../src/app/online/gm/settings.ts';
import { readSavedTable } from '../../../../src/app/online/gm/savedTable.ts';
import { DEFAULT_HOST_ORIGIN } from '../../../../src/app/online/gm/host/hostSettings.ts';
import { TEST_RELAY_ORIGIN } from './relayFixture.ts';

describe('online host configuration', () => {
  it('defaults to the selected production relay and keeps optional reports off', () => {
    expect(DEFAULT_SETTINGS).toEqual({ relayOrigin: DEFAULT_HOST_ORIGIN, feedbackEnabled: false, reportErrors: false });
    expect(DEFAULT_HOST_ORIGIN).toBe('https://atlas.fairfruit.tv');
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('rejects non-local plaintext relay origins without discarding explicit privacy choices', () => {
    expect(readSettings({ relayOrigin: 'http://elsewhere.test', feedbackEnabled: true, reportErrors: true })).toEqual({ ...DEFAULT_SETTINGS, feedbackEnabled: true, reportErrors: true });
  });
  it('requires saved table origins and drops legacy relay connections', () => {
    const prior = { code: 'b'.repeat(26), secret: 'n'.repeat(43), maxPlayers: 12, mapPath: 'maps/a', gate: null };
    expect(readSavedTable(prior)).toBeNull();
    expect(readSavedTable({ ...prior, origin: `${TEST_RELAY_ORIGIN}/` })).toMatchObject({ origin: TEST_RELAY_ORIGIN, code: prior.code });
    expect(readSavedTable({ ...prior, origin: 'https://evil.test/path' })).toBeNull();
  });
  it('uses secure storage only and validates the relay before access checks', async () => {
    let secret: string | null = null;
    const requests: string[] = [];
    const store: HostKeyStore = { available: () => true, get: () => secret, set: (value) => { secret = value; }, clear: () => { secret = null; } };
    let origin = 'https://relay.test';
    let stops = 0;
    let forgets = 0;
    const host = new HostControl({
      http: async (request) => {
        requests.push(request.url);
        return { status: 200, json: { account: { id: 'fairfruit', handle: 'fairfruit', name: 'Fairfruit' }, access: { plan: 'self-hosted', maxPlayers: 12, endsAt: null } } };
      },
      store,
      origin: () => origin,
      saveOrigin: async (next) => { origin = next; },
      stopTable: () => { stops += 1; },
      forgetTable: () => { forgets += 1; },
      confirmOriginChange: async () => true,
      notify: () => undefined,
    });
    expect(requests).toEqual([]);
    expect(await host.setOrigin('http://outside.test')).toBe(false);
    await host.setKey('private-host-key');
    expect(secret).toBe('private-host-key');
    expect(host.state).toBe('ready');
    expect(requests).toEqual(['https://relay.test/api/me']);
    expect(await host.setOrigin('https://new-relay.test/')).toBe(true);
    expect(origin).toBe('https://new-relay.test');
    expect(stops).toBe(1);
    expect(forgets).toBe(1);
    await host.clearKey();
    expect(secret).toBeNull();
    expect(stops).toBe(2);
    expect(forgets).toBe(2);
  });
  it('does not fall back to plaintext when secure storage is unavailable', async () => {
    let sent = 0;
    const host = new HostControl({ http: async () => { sent += 1; return { status: 401, json: null }; }, store: { available: () => false, get: () => null, set: () => { throw new Error('unavailable'); }, clear: () => undefined }, origin: () => 'https://relay.test', saveOrigin: async () => undefined, stopTable: () => undefined, forgetTable: () => undefined, confirmOriginChange: async () => true, notify: () => undefined });
    await host.setKey('key');
    expect(host.state).toBe('secret-storage-unavailable');
    expect(sent).toBe(0);
  });
  it('discards a delayed access answer from a relay that is no longer configured', async () => {
    const delayed = Promise.withResolvers<{ status: number; json: unknown }>();
    let origin = 'https://old-relay.test';
    const store: HostKeyStore = { available: () => true, get: () => 'host-key', set: () => undefined, clear: () => undefined };
    const host = new HostControl({
      http: (request) => request.url.startsWith('https://old-relay.test') ? delayed.promise : Promise.resolve({ status: 401, json: null }),
      store, origin: () => origin, saveOrigin: async (next) => { origin = next; },
      stopTable: () => undefined, forgetTable: () => undefined, confirmOriginChange: async () => true, notify: () => undefined,
    });
    const oldCheck = host.refresh();
    await host.setOrigin('https://new-relay.test');
    expect(host.state).toBe('invalid-key');
    delayed.resolve({ status: 200, json: { account: { id: 'fairfruit', handle: 'fairfruit', name: 'Fairfruit' }, access: { plan: 'self-hosted', maxPlayers: 12, endsAt: null } } });
    await oldCheck;
    expect(host.state).toBe('invalid-key');
    expect(host.access()).toBeNull();
  });

  it('keeps a failed secure-storage clear locally revoked instead of offering the old credential', async () => {
    const host = new HostControl({
      http: async () => { throw new Error('Unexpected network request'); },
      store: { available: () => true, get: () => 'old-host-key', set: () => undefined, clear: () => { throw new Error('Secure storage failed'); } },
      origin: () => 'https://relay.test', saveOrigin: async () => undefined,
      stopTable: () => undefined, forgetTable: () => undefined, confirmOriginChange: async () => true, notify: () => undefined,
    });
    await host.clearKey();
    expect(host.state).toBe('secret-storage-unavailable');
    expect(host.key()).toBeNull();
  });
});
