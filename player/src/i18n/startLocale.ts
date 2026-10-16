import { resolveLocale, setLocale } from '../../../src/app/i18n';

/** Whether Atlas has texts for `language` itself, rather than falling back to English for it. */
function isSpoken(language: string): boolean {
  const code = resolveLocale(language).toLowerCase();
  return language.toLowerCase() === code || language.split('-')[0]?.toLowerCase() === code;
}

/**
 * Selects the language of every later `t` call: the first language of the browser's list that
 * Atlas speaks (`ru-RU` is Russian), else English. The page passes nothing and reads
 * `navigator.languages`.
 */
export function startLocale(languages: readonly string[] = navigator.languages): void {
  setLocale(languages.find(isSpoken) ?? 'en');
}
