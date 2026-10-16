import { describe, expect, it, vi } from 'vitest';
import { SECRET_PATTERN, TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { base32, base64url, randomBase32, randomBase64Url, sameHash, sha256Hex } from '../src/table/codec.ts';
import { SECRET_BYTES, TABLE_CODE_BYTES } from '../src/table/limits.ts';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('base32', () => {
  // RFC 4648 section 10, in lower case and without padding.
  it.each([
    ['', ''],
    ['f', 'my'],
    ['fo', 'mzxq'],
    ['foo', 'mzxw6'],
    ['foob', 'mzxw6yq'],
    ['fooba', 'mzxw6ytb'],
    ['foobar', 'mzxw6ytboi'],
  ])('writes %j as %j', (text, expected) => {
    expect(base32(ascii(text))).toBe(expected);
  });

  it('writes bytes 0 to 15 as the reference does', () => {
    expect(base32(Uint8Array.from({ length: 16 }, (_, index) => index))).toBe('aaaqeayeaudaocajbifqydiob4');
  });

  it('writes 16 bytes as the 26 characters of a table code', () => {
    expect(base32(new Uint8Array(16))).toMatch(TABLE_CODE_PATTERN);
    expect(base32(new Uint8Array(16).fill(255))).toMatch(TABLE_CODE_PATTERN);
  });
});

describe('base64url', () => {
  // RFC 4648 section 10, without padding.
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('writes %j as %j', (text, expected) => {
    expect(base64url(ascii(text))).toBe(expected);
  });

  it('uses - and _ where base64 uses + and /', () => {
    expect(base64url(Uint8Array.of(0xfb, 0xff, 0xbe))).toBe('-_--');
    expect(base64url(Uint8Array.of(0xfb, 0xff))).toBe('-_8');
  });

  it('agrees with btoa on random bytes of every length', () => {
    for (let length = 0; length < 70; length += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const expected = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(base64url(bytes)).toBe(expected);
    }
  });
});

describe('random text', () => {
  it('makes a table code of the protocol\'s pattern from the bytes of a code', () => {
    for (let round = 0; round < 50; round += 1) expect(randomBase32(TABLE_CODE_BYTES)).toMatch(TABLE_CODE_PATTERN);
  });

  it('makes a host secret of the protocol\'s pattern and 43 characters from the bytes of a secret', () => {
    for (let round = 0; round < 50; round += 1) {
      const secret = randomBase64Url(SECRET_BYTES);
      expect(secret).toMatch(SECRET_PATTERN);
      expect(secret).toHaveLength(43);
    }
  });

  it('makes different text each time', () => {
    expect(new Set(Array.from({ length: 100 }, () => randomBase32(TABLE_CODE_BYTES))).size).toBe(100);
    expect(new Set(Array.from({ length: 100 }, () => randomBase64Url(SECRET_BYTES))).size).toBe(100);
  });

  it('uses the runtime\'s random source', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    randomBase32(TABLE_CODE_BYTES);
    randomBase64Url(SECRET_BYTES);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['é', '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
  ])('writes the digest of %j as 64 lower case hex characters', async (text, expected) => {
    expect(await sha256Hex(text)).toBe(expected);
  });
});

describe('sameHash', () => {
  it('says yes to the same digest and no to another of the same length', async () => {
    const digest = await sha256Hex('a secret');
    expect(sameHash(digest, await sha256Hex('a secret'))).toBe(true);
    expect(sameHash(digest, await sha256Hex('another secret'))).toBe(false);
    expect(sameHash(digest, `${digest.slice(0, -1)}${digest.endsWith('0') ? '1' : '0'}`)).toBe(false);
  });

  it('says no to text of another length without throwing', async () => {
    const digest = await sha256Hex('a secret');
    expect(sameHash(digest, digest.slice(1))).toBe(false);
    expect(sameHash(digest, '')).toBe(false);
    expect(sameHash('', digest)).toBe(false);
  });

  it('compares two empty texts as the same', () => {
    expect(sameHash('', '')).toBe(true);
  });

  it('always compares with the runtime\'s constant-time function, also when the lengths differ', async () => {
    const spy = vi.spyOn(crypto.subtle, 'timingSafeEqual');
    const digest = await sha256Hex('x');
    sameHash(digest, digest);
    sameHash(digest, await sha256Hex('y'));
    sameHash(digest, 'short');
    expect(spy).toHaveBeenCalledTimes(3);
    // A different length compares the text with itself, so it takes as long as any other answer.
    const [first, second] = [spy.mock.calls[2]?.[0], spy.mock.calls[2]?.[1]];
    expect(first).toBe(second);
    spy.mockRestore();
  });
});
