/**
 * What a player may send the GM's Atlas, and how often one asset is served: the numbers the GM's
 * checks hold a player to and the player client paces itself below. One home, so the two sides
 * cannot drift apart.
 */

/** A token bucket's shape: `burst` messages at once, then `perSecond` more every second. */
export interface RateLimit {
  readonly burst: number;
  readonly perSecond: number;
}

/** Moves a player may make: a burst of 8, then 6 a second (a held movement key steps 5 times a second). */
export const MOVE_LIMIT: RateLimit = { burst: 8, perSecond: 6 };
/** Drag messages a player may send: a burst of 40, then 40 a second (the browser sends about 30). */
export const DRAG_LIMIT: RateLimit = { burst: 40, perSecond: 40 };
/** Rolls a player may make: a burst of 3, then 1 a second. */
export const ROLL_LIMIT: RateLimit = { burst: 3, perSecond: 1 };
/** Chat messages and edits a player may send: a burst of 5, then one every two seconds. */
export const CHAT_LIMIT: RateLimit = { burst: 5, perSecond: 0.5 };
/** Reactions and deletions a player may send: a burst of 10, then 2 a second. */
export const REACT_LIMIT: RateLimit = { burst: 10, perSecond: 2 };
/** Edits a player may write into their book: a burst of 30, then 2 a second. */
export const BOOK_LIMIT: RateLimit = { burst: 30, perSecond: 2 };
/** Readable pins a player may open: a burst of 5, then one a second. */
export const FIND_LIMIT: RateLimit = { burst: 5, perSecond: 1 };

/** Laser, measure and cursor messages a player may send a second, each kind on its own: a client sends one every `MARKS_INTERVAL_MS`, 10 a second (pages before that sent about 30). */
export const MARKS_PER_SECOND = 40;

/** How long a player's request for the asset it is being sent is ignored (milliseconds). */
export const REPEAT_REQUEST_MS = 10_000;
/**
 * How often one player is sent one asset within `REPEAT_REQUEST_MS`, whatever chunk or longest side
 * they ask for: the first request, a download continued, and one to spare. The chunk and the side
 * are the player's to choose, so without this every other value would be a new request, each one
 * the whole asset sent again or a new scaled copy made.
 */
export const MAX_SERVES_PER_ASSET = 3;
