/**
 * The numbers the relay's table rules are built on, in one place. A rule that needs a number names
 * it here; nothing is exported that no module uses.
 */

/** How long a table lives without its GM: after the GM's last disconnect, or after the table was made if the GM never came. */
export const GM_AWAY_MS = 24 * 60 * 60 * 1000;

/** A table code is 128 random bits: 16 bytes, which lowercase base32 writes as the 26 characters of `TABLE_CODE_PATTERN`. */
export const TABLE_CODE_BYTES = 16;

/** A host secret is 256 random bits: 32 bytes, 43 base64url characters (the protocol asks for 16 to 128). */
export const SECRET_BYTES = 32;

/**
 * How long an event waits after its handler failed before it runs again. Fixed, since the one thing
 * that fails in practice is a storage call that a moment later works; at most one alarm a minute
 * for a table whose handler keeps failing.
 */
export const EVENT_RETRY_MS = 60 * 1000;
