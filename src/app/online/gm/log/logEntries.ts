import { GM_AUTHOR, isRecord, MAX_LOG_ENTRIES, MAX_PLAYERS, parseLogEntry, PLAYER_ID_PATTERN, quoting, type LogEntry } from '../../protocol/index.ts';
import type { TokenEntity } from '../../../types';
import type { DiceRollResult } from '../../../types/diceTypes';

/** The longest token name and artwork path the GM's log keeps with a roll. */
const MAX_FACE_TEXT = 1000;

/** The token a roll was made for, as the GM's own log names it: its name and its artwork in the vault. */
export interface RollFace {
  readonly name: string;
  readonly image: string | null;
}

/** The token Atlas made a roll for, as the roll names it: its name, and the artwork the roll or the token on the map has. */
export function rollFaceOf(source: DiceRollResult['source'], tokens: Readonly<Record<string, TokenEntity>>): { readonly face?: RollFace } {
  const name = source?.tokenName;
  if (source === undefined || name === undefined || name === '') return {};
  const image = source.tokenImagePath ?? (source.tokenId === undefined ? undefined : tokens[source.tokenId]?.imagePath);
  return { face: { name: name.slice(0, MAX_FACE_TEXT), image: image === undefined || image === '' || image.length > MAX_FACE_TEXT ? null : image } };
}

/** The readable pin a found note's entry was found at: the map, the pin's id there and its link as it was then. */
export interface FoundPin {
  readonly map: string;
  readonly pin: string;
  readonly link: string;
}

/**
 * An entry as the GM keeps it: what players are sent, and beside it what only the GM's log has.
 * `hidden`: players never get the entry (a GM's roll they are not shown). `face`: the roll's token.
 * `speakerArt`: the vault path of the speaking token's artwork, which its viewers may be sent.
 * `imageFile`: the vault path of an image the GM showed, which players may be sent while it is logged.
 * `pin`: the readable pin a found note was found at.
 */
export type ActionAudience = '*' | 'gm' | readonly string[];
export type GmLogEntry = LogEntry & { readonly hidden?: true; readonly face?: RollFace; readonly speakerArt?: string; readonly imageFile?: string; readonly pin?: FoundPin; readonly audience?: ActionAudience; readonly origins?: Readonly<Record<string, string>> };

/** The token the GM's log names for an entry, when it holds one. */
export function faceOf(entry: LogEntry): RollFace | undefined {
  return (entry as GmLogEntry).face;
}

/** An entry as players are sent it: without what only the GM's log has. */
export function sharedEntry(entry: GmLogEntry): LogEntry {
  const { hidden: _hidden, face: _face, speakerArt: _art, imageFile: _file, pin: _pin, audience: _audience, origins: _origins, ...shared } = entry;
  return shared;
}

/** Whether an entry goes to everyone alike: no whisper, no private roll, nothing only the GM has. */
export function isOpen(entry: GmLogEntry): boolean {
  return entry.hidden !== true && entry.origins === undefined && !('to' in entry && entry.to !== undefined) && (entry.kind !== 'action' || entry.audience === '*');
}

/** Who sees an entry whole: its author and its audience; everyone where it has none. */
export function seesWhole(entry: LogEntry, viewer: string): boolean {
  if (entry.kind === 'action') {
    const audience = (entry as GmLogEntry).audience;
    return viewer === GM_AUTHOR || audience === '*' || (Array.isArray(audience) && audience.includes(viewer));
  }
  if (entry.kind !== 'chat' && entry.kind !== 'roll') return true;
  if (entry.to === undefined) return true;
  // A blind roll's author learns only that they rolled.
  const author = entry.kind === 'chat' || entry.mode !== 'blind' ? entry.who === viewer : false;
  return author || entry.to.includes(viewer);
}

/**
 * An entry as one viewer is sent it (`'gm'` or a player's id): whole, a line that a roll was made
 * in private, or nothing (a whisper to others, a GM's roll players are not shown).
 */
export function viewOf(entry: GmLogEntry, viewer: string): LogEntry | null {
  if (entry.hidden === true) return viewer === GM_AUTHOR ? sharedEntry(entry) : null;
  if (entry.kind === 'action' && !seesWhole(entry, viewer)) return null;
  if (seesWhole(entry, viewer)) {
    const shared = sharedEntry(entry);
    if (shared.kind !== 'roll' || entry.origins === undefined || viewer === GM_AUTHOR) return shared;
    const token = entry.origins[viewer] ?? null;
    const roll = token === null && shared.roll.source !== undefined ? { ...shared.roll, source: { type: shared.roll.source.type } } : shared.roll;
    return { ...shared, token, roll };
  }
  if (entry.kind !== 'roll' || entry.mode === undefined) return null;
  // Who spoke is no part of the line: a hidden NPC would be named by it.
  const { id, at, who, name, mode } = entry;
  return { id, at, who, name, kind: 'secret', mode };
}

const encoder = new TextEncoder();

/** The newest entries whose JSON fits `bytes` together, oldest first. */
export function entriesWithin<Entry extends LogEntry>(entries: readonly Entry[], bytes: number): Entry[] {
  let left = bytes;
  let from = entries.length;
  while (from > 0) {
    left -= encoder.encode(JSON.stringify(entries[from - 1])).length + 1;
    if (left < 0) break;
    from -= 1;
  }
  return entries.slice(from);
}

function readFace(value: unknown): RollFace | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '' || value.name.length > MAX_FACE_TEXT) return undefined;
  const image = typeof value.image === 'string' && value.image !== '' && value.image.length <= MAX_FACE_TEXT ? value.image : null;
  return { name: value.name, image };
}

/** The log as kept with a table: its entries, and the players it counts as there (a line said they joined, none yet that they left). */
export interface SavedLog {
  readonly entries: readonly GmLogEntry[];
  readonly present: readonly string[];
}

/** The log as kept with a table, each part checked; what cannot be read is left out. */
export function readSavedLog(saved: unknown): { entries: GmLogEntry[]; present: string[] } {
  if (!isRecord(saved)) return { entries: [], present: [] };
  const present = Array.isArray(saved.present) ? saved.present.filter((id): id is string => typeof id === 'string' && PLAYER_ID_PATTERN.test(id)) : [];
  return { entries: readLogEntries(saved.entries), present: [...new Set(present)].slice(0, MAX_PLAYERS * 4) };
}

/** Entries as kept with a table, each checked as a client checks it; what cannot be read is left out. */
function readLogEntries(saved: unknown): GmLogEntry[] {
  if (!Array.isArray(saved)) return [];
  const entries: GmLogEntry[] = [];
  // Twice the log's size: the shared entries and those only the GM has are counted apart.
  for (const value of saved.slice(-2 * MAX_LOG_ENTRIES)) {
    const entry = parseLogEntry(value);
    if (entry === null || !isRecord(value)) continue;
    const face = entry.kind === 'roll' ? readFace(value.face) : undefined;
    const speakerArt = vaultPath(value.speakerArt);
    const imageFile = entry.kind === 'image' ? vaultPath(value.imageFile) : undefined;
    const pin = entry.kind === 'found' ? readFoundPin(value.pin) : undefined;
    const audience = entry.kind === 'action' ? readActionAudience(value.audience, entry.action) : undefined;
    const origins = entry.kind === 'roll' && value.origins !== undefined ? readOrigins(value.origins) : undefined;
    entries.push({
      ...entry,
      ...(value.hidden === true && { hidden: true as const }),
      ...(face !== undefined && { face }),
      ...(speakerArt !== undefined && { speakerArt }),
      ...(imageFile !== undefined && { imageFile }),
      ...(pin !== undefined && { pin }),
      ...(audience !== undefined && { audience }),
      ...(origins === undefined ? {} : { origins }),
    });
  }
  return entries;
}

function readOrigins(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter((entry): entry is [string, string] => PLAYER_ID_PATTERN.test(entry[0]) && typeof entry[1] === 'string' && /^[0-9a-f]{24}$/.test(entry[1]));
  return Object.fromEntries(entries.slice(0, MAX_PLAYERS));
}

function readActionAudience(value: unknown, action: Extract<LogEntry, { kind: 'action' }>['action']): ActionAudience {
  if (action === 'turn-ended') return '*';
  if (action === 'approval-reminder') return 'gm';
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && PLAYER_ID_PATTERN.test(id)))].slice(0, MAX_PLAYERS) : 'gm';
}

export function speakerArtIn(entries: readonly GmLogEntry[], hash: string, viewer: string): string | undefined {
  for (const entry of entries) {
    if (viewer !== GM_AUTHOR && (!seesWhole(entry, viewer) || (entry.hidden === true && viewOf(entry, viewer) === null))) continue;
    if (entry.speakerArt !== undefined && 'speaker' in entry && entry.speaker?.art?.hash === hash) return entry.speakerArt;
  }
  return undefined;
}

export function imageFileIn(entries: readonly GmLogEntry[], hash: string, viewer: string): string | undefined {
  for (const entry of entries) {
    if (viewer !== GM_AUTHOR && (!seesWhole(entry, viewer) || (entry.hidden === true && viewOf(entry, viewer) === null))) continue;
    if (entry.kind === 'image' && entry.image.hash === hash && entry.imageFile !== undefined) return entry.imageFile;
  }
  return undefined;
}

/** A vault path as kept with an entry, or undefined. */
function vaultPath(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value.length <= MAX_FACE_TEXT ? value : undefined;
}

/** Whether an entry takes reactions: what was said, rolled, shown, handed out or found. */
export function takesReactions(entry: LogEntry): entry is Extract<LogEntry, { readonly kind: 'chat' | 'roll' | 'image' | 'loot' | 'found' }> {
  return entry.kind === 'chat' || entry.kind === 'roll' || entry.kind === 'image' || entry.kind === 'loot' || entry.kind === 'found';
}

/** Whether the GM may delete an entry: a chat message, an image shown, an item handed out, a note found (which may then be found again). */
export const isRemovable = (entry: LogEntry): boolean => entry.kind === 'chat' || entry.kind === 'image' || entry.kind === 'loot' || entry.kind === 'found';

/** A readable pin as kept with a found note's entry, or undefined. */
function readFoundPin(value: unknown): FoundPin | undefined {
  if (!isRecord(value)) return undefined;
  const [map, pin, link] = [vaultPath(value.map), vaultPath(value.pin), vaultPath(value.link)];
  return map === undefined || pin === undefined || link === undefined ? undefined : { map, pin, link };
}

/**
 * The answers to the entry `id` quote its new text, or nothing once it was deleted (null). Players
 * are told nothing more: their pages do the same by the same rule (`quoting`), so a message with
 * many answers costs one frame to change, not one for each. An answer to a whisper is a whisper to
 * the same people, so the quote reaches only those who were shown what it quotes.
 */
export function requoted(list: readonly GmLogEntry[], id: string, text: string | null): GmLogEntry[] {
  return list.map((other) => (other.kind === 'chat' && other.reply?.id === id ? { ...other, reply: quoting(other.reply, text) } : other));
}
