import { MAX_PLAYERS, TABLE_CODE_PATTERN } from '../protocol/index.ts';
export interface CreatedTable { readonly code: string; readonly secret: string; readonly maxPlayers: number; }
export function seatsOf(value: unknown): number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PLAYERS ? value : MAX_PLAYERS; }
function refusalText(status: number, reason: unknown): string {
  if (status === 401) return 'The relay refused the host key. Check it in Online settings.';
  if (status === 403) return 'This host key cannot create tables.';
  if (status === 429) return 'Too many tries. Try again in a minute.';
  if (status === 503 && reason === 'not-configured') return 'This relay is not configured to host tables.';
  if (status === 503) return 'The relay could not create a table. Try again in a moment.';
  return `The relay could not create a table (${status}).`;
}
export function readCreated(status: number, body: unknown): CreatedTable | string {
  const fields = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  if (status !== 201) return refusalText(status, fields.reason);
  const { code, secret } = fields;
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code) || typeof secret !== 'string' || secret.length < 32) return 'The relay answered with something that is no table.';
  return { code, secret, maxPlayers: seatsOf(fields.maxPlayers) };
}
