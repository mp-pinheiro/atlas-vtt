import { PLAYER_ID_PATTERN, SECRET_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import type { PlayerIdentity } from '../state/playerStore.ts';

export interface IdentityStorage {
  get(): PlayerIdentity;
  set(value: PlayerIdentity): void;
  clear(): void;
  readonly persistent: boolean;
}

export function playerIdentity(table: string, storage?: Storage | null): IdentityStorage {
  if (storage === undefined) {
    try { storage = globalThis.localStorage ?? null; }
    catch { storage = null; }
  }
  const key = `atlas-player:${table}`;
  let memory: PlayerIdentity = {};
  let persistent = storage !== null;
  return {
    get(): PlayerIdentity {
      if (!persistent || storage === null) return memory;
      try {
        const raw: unknown = JSON.parse(storage.getItem(key) ?? '{}');
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
        const value = raw as Record<string, unknown>;
        memory = {
          ...(typeof value.playerId === 'string' && PLAYER_ID_PATTERN.test(value.playerId) ? { playerId: value.playerId } : {}),
          ...(typeof value.key === 'string' && SECRET_PATTERN.test(value.key) ? { key: value.key } : {}),
          ...(typeof value.wait === 'string' && SECRET_PATTERN.test(value.wait) ? { wait: value.wait } : {}),
        };
        return memory;
      } catch {
        persistent = false;
        return memory;
      }
    },
    set(value: PlayerIdentity): void {
      memory = value;
      if (!persistent || storage === null) return;
      try { storage.setItem(key, JSON.stringify(value)); } catch { persistent = false; }
    },
    clear(): void {
      memory = {};
      try { storage?.removeItem(key); } catch { persistent = false; }
    },
    get persistent(): boolean { return persistent; },
  };
}
