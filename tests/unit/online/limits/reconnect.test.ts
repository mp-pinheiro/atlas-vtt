// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoff as backoffOfTableConnection, socketUrl as socketUrlOfTableConnection } from '../../../../src/app/online/gm/TableConnection.ts';
import { backoff, BASE_BACKOFF_MS, MAX_BACKOFF_MS, socketUrl } from '../../../../src/app/online/limits/reconnect.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the delay before a reconnect', () => {
  it('doubles from half a second, and jitter takes between half and all of it', () => {
    expect(backoff(0, () => 0)).toBe(BASE_BACKOFF_MS * 0.5);
    expect(backoff(0, () => 1)).toBe(BASE_BACKOFF_MS);
    expect(backoff(1, () => 1)).toBe(1000);
    expect(backoff(2, () => 1)).toBe(2000);
    expect(backoff(3, () => 0.5)).toBe(4000 * 0.75);
  });

  it('stops growing at 30 seconds', () => {
    expect(MAX_BACKOFF_MS).toBe(30_000);
    expect(backoff(6, () => 1)).toBe(30_000);
    expect(backoff(60, () => 1)).toBe(30_000);
    expect(backoff(60, () => 0)).toBe(15_000);
  });

  it('takes its jitter from the cryptographic source and not from Math.random', () => {
    const math = vi.spyOn(Math, 'random');
    const crypt = vi.spyOn(crypto, 'getRandomValues');
    const delays = new Set(Array.from({ length: 20 }, () => backoff(4)));
    expect(math).not.toHaveBeenCalled();
    expect(crypt).toHaveBeenCalledTimes(20);
    expect(delays.size).toBeGreaterThan(1);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThan(8000);
    }
  });

  it('is the function the GM\'s connection has always exported', () => {
    expect(backoffOfTableConnection).toBe(backoff);
  });
});

describe('the address of a table\'s socket', () => {
  const code = 'abcdefghijklmnopqrstuvwxyz'.slice(0, 26);

  it('turns https into wss and http into ws', () => {
    expect(socketUrl('https://relay.example', code)).toBe(`wss://relay.example/api/tables/${code}/socket`);
    expect(socketUrl('http://localhost:8787', code)).toBe(`ws://localhost:8787/api/tables/${code}/socket`);
  });

  it('is the function the GM\'s connection has always exported', () => {
    expect(socketUrlOfTableConnection).toBe(socketUrl);
  });
});
