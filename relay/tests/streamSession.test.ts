import { describe, expect, it, vi } from 'vitest';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { StreamReader, streamSendBody, type StreamLine } from '../../src/app/online/protocol/stream.ts';
import { StreamSessions } from '../src/streamSession.ts';

interface OpenStream {
  readonly manager: StreamSessions;
  readonly secret: string;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly parser: StreamReader;
}
async function opened(onFrame: (frame: unknown) => Promise<void>): Promise<OpenStream> {
  const manager = new StreamSessions();
  const response = await manager.open('a'.repeat(20), 'Alice', 1, true, onFrame, [], new AbortController().signal, null, () => true);
  if (response.body === null) throw new Error('SSE body is missing');
  const reader = response.body.getReader();
  const parser = new StreamReader();
  const first = await reader.read();
  const session = parser.read(new TextDecoder().decode(first.value))?.find((line) => line.kind === 'session');
  if (session?.kind !== 'session') throw new Error('Session must be the first line');
  return { manager, secret: session.secret, reader, parser };
}
async function terminal(stream: OpenStream): Promise<Extract<StreamLine, { kind: 'close' }>> {
  for (let count = 0; count < 40; count++) {
    const chunk = await stream.reader.read();
    if (chunk.done) throw new Error('SSE ended without a terminal line');
    const closed = stream.parser.read(new TextDecoder().decode(chunk.value))?.find((line) => line.kind === 'close');
    if (closed?.kind === 'close') return closed;
  }
  throw new Error('SSE did not terminate within its bounded buffer');
}

describe('SSE session execution', () => {
  it('refuses an overlapping upstream post before applying any of its frames', async () => {
    let release!: () => void;
    let entered!: () => void;
    let applied = 0;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const stream = await opened(async () => { entered(); await blocked; applied += 1; });
    try {
      const body = streamSendBody(stream.secret, [JSON.stringify({ v: 1, t: 'send', body: { action: 1 } })]);
      const first = stream.manager.send(body);
      await started;
      expect((await stream.manager.send(body)).status).toBe(409);
      release();
      expect((await first).status).toBe(204);
      expect(applied).toBe(1);
    } finally {
      release();
      stream.manager.closeAll(1000, 'finished');
      await stream.reader.cancel();
    }
  });

  it('preflights the SSE player bucket before applying an over-limit batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    let applied = 0;
    const stream = await opened(async () => { applied += 1; });
    try {
      for (let batch = 0; batch < 9; batch++) {
        const frames = Array.from({ length: 32 }, (_, index) => JSON.stringify({ v: 1, t: 'send', body: { sequence: batch * 32 + index } }));
        expect((await stream.manager.send(streamSendBody(stream.secret, frames))).status).toBe(204);
      }
      const overLimit = Array.from({ length: 13 }, (_, index) => JSON.stringify({ v: 1, t: 'send', body: { refusedBatch: index } }));
      const response = await stream.manager.send(streamSendBody(stream.secret, overLimit));
      expect(response.status).toBe(429);
      expect(applied).toBe(288);
      expect(await terminal(stream)).toMatchObject({ kind: 'close', code: CLOSE.rateLimited });
    } finally {
      await stream.reader.cancel();
      vi.useRealTimers();
    }
  });

  it('parses a batch atomically and closes malformed frames without applying an earlier valid one', async () => {
    let applied = 0;
    const stream = await opened(async () => { applied += 1; });
    try {
      const body = streamSendBody(stream.secret, [JSON.stringify({ v: 1, t: 'send', body: { action: 1 } }), '{broken']);
      expect((await stream.manager.send(body)).status).toBe(400);
      expect(applied).toBe(0);
      expect((await terminal(stream)).code).toBe(CLOSE.protocol);
    } finally {
      stream.manager.closeAll(1000, 'finished');
      await stream.reader.cancel();
    }
  });

  it('expires at the upstream inactivity boundary and reports a retryable transport closure', async () => {
    const stream = await opened(async () => { throw new Error('Unexpected game frame'); });
    try {
      const deadline = stream.manager.nextDeadline();
      if (deadline === null) throw new Error('Missing inactivity deadline');
      stream.manager.expire(deadline - 1);
      expect(stream.manager.people()).toEqual([{ id: 'a'.repeat(20), name: 'Alice' }]);
      stream.manager.expire(deadline);
      expect(stream.manager.people()).toEqual([]);
      expect((await terminal(stream)).code).toBe(1001);
      expect((await stream.manager.send(streamSendBody(stream.secret, []))).status).toBe(410);
    } finally {
      stream.manager.closeAll(1000, 'finished');
      await stream.reader.cancel();
    }
  });

  it('closes a slow consumer before an unbounded downstream queue can accumulate', async () => {
    const stream = await opened(async () => { throw new Error('Unexpected game frame'); });
    try {
      const frame = { v: 1, t: 'game', body: { payload: 'x'.repeat(64 * 1024) } };
      for (let index = 0; index < 20; index++) stream.manager.publish('*', frame);
      expect(stream.manager.people()).toEqual([]);
      expect((await terminal(stream)).code).toBe(CLOSE.rateLimited);
    } finally {
      stream.manager.closeAll(1000, 'finished');
      await stream.reader.cancel();
    }
  });
});
