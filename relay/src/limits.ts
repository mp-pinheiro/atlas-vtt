import { MAX_GM_FRAME, MAX_PLAYER_FRAME } from '../../src/app/online/protocol/relay.ts';
import { MAX_STREAM_BATCH, MAX_STREAM_BODY, MAX_STREAM_HELLO } from '../../src/app/online/protocol/stream.ts';

export { MAX_GM_FRAME, MAX_PLAYER_FRAME, MAX_STREAM_BATCH, MAX_STREAM_BODY, MAX_STREAM_HELLO };
export const MAX_PREHELLO_SOCKETS = 32;
export const HANDSHAKE_MS = 10_000;
export const TABLE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const WAIT_MS = 5 * 60 * 1000;
export const STREAM_IDLE_MS = 90_000;
export const STREAM_MAX_BUFFER = 1024 * 1024;
export const SOCKET_RATE = { gmBurst: 200, gmPerSecond: 100, playerBurst: 300, playerPerSecond: 150 } as const;
export const utf8Size = (text: string): number => new TextEncoder().encode(text).byteLength;

export async function readUtf8Body(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}
