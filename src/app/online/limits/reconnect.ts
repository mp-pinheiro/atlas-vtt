/** The first reconnect delay before jitter, in milliseconds; each further attempt doubles it. */
export const BASE_BACKOFF_MS = 500;
/** The longest reconnect delay before jitter, in milliseconds. */
export const MAX_BACKOFF_MS = 30_000;

/** A random fraction from 0 up to (not including) 1, from the cryptographic source. */
function cryptoFraction(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}

/** A reconnect delay: doubling from half a second up to 30 seconds, with jitter from the cryptographic source. */
export function backoff(attempt: number, random: () => number = cryptoFraction): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.5 + random() / 2);
}

/** The socket address of a table on a server origin (`https://…` becomes `wss://…`). */
export function socketUrl(origin: string, code: string): string {
  return `${origin.replace(/^http/, 'ws')}/api/tables/${code}/socket`;
}
