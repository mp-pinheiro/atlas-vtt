import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followColorScheme } from '../../../src/host/colorScheme';

/** A `matchMedia` that answers for the dark scheme and lets a test change the answer. */
function stubScheme(initiallyDark: boolean): { setDark(dark: boolean): void; listeners(): number } {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() { return query === '(prefers-color-scheme: dark)' && dark; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    setDark(next) {
      dark = next;
      for (const listener of [...listeners]) listener();
    },
    listeners: () => listeners.size,
  };
}

describe('followColorScheme', () => {
  beforeEach(() => document.body.classList.remove('theme-dark', 'theme-light'));
  afterEach(() => vi.unstubAllGlobals());

  it('marks the body dark when the browser prefers dark', () => {
    stubScheme(true);
    followColorScheme();
    expect([...document.body.classList]).toEqual(['theme-dark']);
  });

  it('marks the body light otherwise', () => {
    stubScheme(false);
    followColorScheme();
    expect([...document.body.classList]).toEqual(['theme-light']);
  });

  it('follows a change of the scheme until it is stopped', () => {
    const scheme = stubScheme(false);
    const stop = followColorScheme();
    scheme.setDark(true);
    expect([...document.body.classList]).toEqual(['theme-dark']);
    stop();
    expect(scheme.listeners()).toBe(0);
    scheme.setDark(false);
    expect([...document.body.classList]).toEqual(['theme-dark']);
  });
});
