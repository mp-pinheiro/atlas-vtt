import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, t } from '../../../../src/app/i18n';
import { startLocale } from '../../../src/i18n/startLocale';

describe('startLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setLocale('en');
  });

  it('picks Russian for a Russian region', () => {
    startLocale(['ru-RU']);
    expect(getLocale()).toBe('ru');
    expect(t('command.openDashboard')).toBe('Открыть панель');
  });

  it('falls back to English for a language Atlas does not speak', () => {
    startLocale(['fr-FR', 'de']);
    expect(getLocale()).toBe('en');
    expect(t('command.openDashboard')).toBe('Open dashboard');
  });

  it('takes the first language of the list that Atlas speaks', () => {
    startLocale(['fr-FR', 'ru-RU', 'en']);
    expect(getLocale()).toBe('ru');
  });

  it('keeps English where the browser prefers it to a later language', () => {
    startLocale(['en-GB', 'ru']);
    expect(getLocale()).toBe('en');
  });

  it('uses English when the browser names no language', () => {
    setLocale('ru');
    startLocale([]);
    expect(getLocale()).toBe('en');
  });

  it('reads the browser\'s languages when none are passed', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ru']);
    startLocale();
    expect(getLocale()).toBe('ru');
  });
});
