export const DEFAULT_HOST_ORIGIN = 'https://atlas.fairfruit.tv';

export function readRelayOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('?') || value.includes('#')) return null;
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) return null;
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    return url.origin;
  } catch {
    return null;
  }
}
