import { SECRET_PATTERN, TABLE_CODE_PATTERN } from '../protocol/index.ts';
import { seatsOf, type CreatedTable } from './createdTable.ts';
import { readGate, type GateSettings } from './joinGate.ts';
import { readRelayOrigin } from './host/hostSettings.ts';
const MAX_MAP_PATH = 1000;
export interface SavedTable extends CreatedTable { readonly origin: string; readonly mapPath: string | null; readonly gate: GateSettings; }
export function readSavedTable(data: unknown): SavedTable | null {
  if (typeof data !== 'object' || data === null) return null;
  const { code, secret, mapPath, maxPlayers, gate, origin } = data as Record<string, unknown>;
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code) || typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return null;
  const checkedOrigin = readRelayOrigin(origin);
  if (checkedOrigin === null) return null;
  const path = typeof mapPath === 'string' && mapPath !== '' && mapPath.length <= MAX_MAP_PATH ? mapPath : null;
  return { code, secret, maxPlayers: seatsOf(maxPlayers), origin: checkedOrigin, mapPath: path, gate: readGate(gate) };
}
