import { t, TRANSLATIONS } from '../../src/app/i18n/index.ts';
import type { MessageKey, MessageValues } from '../../src/app/i18n/types.ts';

export const PLAYER_LOCALES = Object.keys(TRANSLATIONS);
export type PlayerLocale = (typeof PLAYER_LOCALES)[number];
type BrowserMessageKey = Extract<MessageKey, `onlinePlayer.${string}`>;
export type PlayerMessageKey = BrowserMessageKey extends `onlinePlayer.${infer Key}` ? Key : never;

export function playerText(key: PlayerMessageKey, values?: MessageValues): string {
  return t(`onlinePlayer.${key}`, values);
}
