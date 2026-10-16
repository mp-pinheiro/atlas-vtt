/**
 * The relay address: where online play connects, entered by the GM in the settings. It names the
 * origin of a table server, which answers the companion and serves the page players open, so the
 * join link is that origin with the table's code after `#`. Pure: no Obsidian, no network.
 */

/** Hosts that may be reached without TLS: the GM's own machine, where a relay runs under `wrangler dev`. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A scheme and an authority, then at most one `/`: no path (not even `/./`), no query or hash (an
 * empty one too), no whitespace, which the URL parser would drop from the middle of a text, and no
 * backslash, which it reads as a `/` in an `http` address.
 */
const ORIGIN_TEXT = /^https?:\/\/[^\s/\\?#]+\/?$/i;

function hasControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * The origin of a relay address as the GM typed it, or null when it is not one a companion may send
 * a table to: `https` for any host, `http` only for `localhost`, `127.0.0.1` and `[::1]`, and nothing
 * but the host and a port: no credentials, no path, no query, no hash. A trailing `/` is allowed and
 * dropped, the host is lower-cased and a default port is left out.
 */
export function normalizeRelayAddress(input: string): string | null {
  const text = input.trim();
  if (!ORIGIN_TEXT.test(text) || hasControlCharacter(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.pathname !== '/') return null;
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return null;
  return url.origin;
}
