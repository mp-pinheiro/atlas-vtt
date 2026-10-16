import { requireApiVersion, type App } from 'obsidian';

export const HOST_KEY_SECRET_ID = 'atlas-online-host-key';
export const HOST_SECRET_STORAGE_VERSION = '1.11.4';

export interface HostKeyStore {
  available(): boolean;
  get(): string | null;
  set(value: string): void;
  clear(): void;
}

export function hostKeyStore(app: App): HostKeyStore {
  if (!requireApiVersion(HOST_SECRET_STORAGE_VERSION)) return {
    available: () => false,
    get: () => null,
    set: () => { throw new Error(`Hosting needs Obsidian ${HOST_SECRET_STORAGE_VERSION} or newer with secure storage.`); },
    clear: () => { throw new Error('Secure storage is unavailable.'); },
  };
  const storage = app.secretStorage;
  const available = (): boolean => {
    try {
      storage.getSecret(HOST_KEY_SECRET_ID);
      return true;
    } catch {
      return false;
    }
  };
  return {
    available,
    get: () => {
      try {
        const value = storage.getSecret(HOST_KEY_SECRET_ID);
        return value === '' ? null : value;
      } catch {
        return null;
      }
    },
    set: (value) => storage.setSecret(HOST_KEY_SECRET_ID, value),
    clear: () => storage.setSecret(HOST_KEY_SECRET_ID, ''),
  };
}
