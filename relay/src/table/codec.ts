import { sha256 } from '../../../src/app/utils/hashing.ts';

/**
 * Text forms of random bytes and hashes: the table code, the host secret and the SHA-256 digests
 * the relay keeps instead of any of them. Pure functions over the Workers runtime's Web Crypto.
 */

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const encoder = new TextEncoder();

/** Bytes as lowercase RFC 4648 base32 without padding. */
export function base32(bytes: Uint8Array): string {
  let text = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32_ALPHABET.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return bits > 0 ? text + BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31) : text;
}

/** Bytes as RFC 4648 base64url without padding. */
export function base64url(bytes: Uint8Array): string {
  let text = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      text += BASE64URL_ALPHABET.charAt((buffer >>> (bits - 6)) & 63);
      bits -= 6;
    }
    buffer &= (1 << bits) - 1;
  }
  return bits > 0 ? text + BASE64URL_ALPHABET.charAt((buffer << (6 - bits)) & 63) : text;
}

function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** `count` random bytes as lowercase base32. */
export function randomBase32(count: number): string {
  return base32(randomBytes(count));
}

/** `count` random bytes as base64url. */
export function randomBase64Url(count: number): string {
  return base64url(randomBytes(count));
}

/** The SHA-256 of a text's UTF-8 bytes, as 64 lowercase hex characters: the plugin's own digest (`sha256`) over the text's bytes. */
export function sha256Hex(text: string): Promise<string> {
  return sha256(encoder.encode(text));
}

/**
 * Whether two digests are the same text, compared in constant time. The runtime throws for buffers
 * of different lengths, and answering early would leak the length, so unequal lengths compare the
 * left side with itself and answer no, as Cloudflare's documentation advises.
 */
export function sameHash(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) {
    crypto.subtle.timingSafeEqual(left, left);
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}
