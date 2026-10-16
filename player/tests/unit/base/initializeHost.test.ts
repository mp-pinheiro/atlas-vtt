import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('initializeHost', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ru-RU']);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.classList.remove('theme-dark', 'theme-light');
    document.documentElement.lang = 'en';
  });

  it('binds the DOM host, the language and the colour scheme before the page draws', async () => {
    // A fresh copy of every module, so the host binding and the language below are the import's.
    const { getDomHost } = await import('../../../../src/app/host/dom');
    const { getLocale } = await import('../../../../src/app/i18n');
    const { playerDomHost } = await import('../../../src/host/domHost');
    expect(() => getDomHost()).toThrow();
    await import('../../../src/host/initializeHost');
    expect(getDomHost()).toBe(playerDomHost);
    expect(getLocale()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
  });
});
