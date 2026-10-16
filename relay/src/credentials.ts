export const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));
export const sha256 = async (value: string): Promise<string> => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
export function equalDigest(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < 64; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
export const secret = (): string => {
  const bytes = randomBytes(32);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};
export const base32 = (bytes: Uint8Array): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let buffer = 0;
  let bits = 0;
  let result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
};
export const tableCode = (): string => base32(randomBytes(16));
export const playerId = (): string => base32(randomBytes(12));
