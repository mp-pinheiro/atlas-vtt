import { SECRET_PATTERN, TABLE_CODE_PATTERN } from '../protocol/index.ts';
import { seatsOf, type CreatedTable } from './createdTable.ts';
import { readGate, type GateSettings } from './joinGate.ts';
import { normalizeRelayAddress } from './relayAddress.ts';

/** The longest map path kept. */
const MAX_MAP_PATH = 1000;

/**
 * A running table as the companion's data keeps it, so a reload of Obsidian or of the companion comes
 * back to it: its code and host secret, the relay it lives on, the map file players were shown, and its
 * gates (the join code is kept here like the host secret: the relay has only its hash). Cleared when
 * the GM stops the table or the server ends it.
 */
export interface SavedTable extends CreatedTable {
  /** The relay the table was made on (an origin): it lives only there, whatever the settings say later. Null for a table saved before it was kept. */
  readonly origin: string | null;
  /** The shared scene's map file, found again by this path; null until a map was shared. */
  readonly mapPath: string | null;
  /** The join code and the two switches; a table saved before it had gates gets new ones, both on. */
  readonly gate: GateSettings;
}

/** A saved table whose relay is known: what a table is run from. */
export type TableOnRelay = SavedTable & { readonly origin: string };

/** The origin kept with a table: null where none was kept; undefined where what is kept is no relay address, which makes the table unreadable. */
function readOrigin(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? normalizeRelayAddress(value) ?? undefined : undefined;
}

/** The saved table from the plugin's data, each field checked; null when there is none or it is unreadable. */
export function readSavedTable(data: unknown): SavedTable | null {
  if (typeof data !== 'object' || data === null) return null;
  const { code, secret, mapPath, maxPlayers, gate, origin } = data as Record<string, unknown>;
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code) || typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return null;
  // The host secret goes to the relay the table lives on and to no other: where that is unknown, the table is not read.
  const relay = readOrigin(origin);
  if (relay === undefined) return null;
  const path = typeof mapPath === 'string' && mapPath !== '' && mapPath.length <= MAX_MAP_PATH ? mapPath : null;
  return { code, secret, origin: relay, maxPlayers: seatsOf(maxPlayers), mapPath: path, gate: readGate(gate) };
}
