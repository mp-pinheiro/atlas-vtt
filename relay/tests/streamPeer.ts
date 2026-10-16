import { SELF } from 'cloudflare:test';
import { parseRelayFrame, type RelayFrame } from '../../src/app/online/protocol/relay.ts';
import { StreamReader, streamSendBody, type StreamLine } from '../../src/app/online/protocol/stream.ts';
import type { TestTable } from './peers.ts';

interface FrameWaiter {
  readonly matches: (frame: RelayFrame) => boolean;
  readonly resolve: (frame: RelayFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: number;
}

export class StreamPeer {
  first: StreamLine | null = null;
  readonly closed: Promise<number>;
  private resolveClose!: (code: number) => void;
  private secret: string | null = null;
  private readonly frames: RelayFrame[] = [];
  private readonly waiters = new Set<FrameWaiter>();
  private readonly reading: Promise<void>;
  private failure: Error | null = null;
  private ended = false;

  constructor(private readonly table: TestTable, private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.closed = new Promise<number>((resolve) => { this.resolveClose = resolve; });
    this.reading = this.read().catch((error: unknown) => {
      this.failure = error instanceof Error ? error : new Error(String(error));
      this.finish(1006);
    });
  }

  private async read(): Promise<void> {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    const parser = new StreamReader();
    while (!this.ended) {
      const chunk = await this.reader.read();
      if (chunk.done) break;
      const lines = parser.read(decoder.decode(chunk.value, { stream: true }));
      if (lines === null) throw new Error('Invalid SSE line');
      for (const line of lines) {
        this.first ??= line;
        if (line.kind === 'session') this.secret = line.secret;
        else if (line.kind === 'close') { this.finish(line.code); return; }
        else if (line.kind === 'frame') {
          const frame = parseRelayFrame(line.text);
          if (frame === null) throw new Error('Malformed relay frame in SSE');
          let delivered = false;
          for (const waiter of this.waiters) {
            if (!waiter.matches(frame)) continue;
            clearTimeout(waiter.timer);
            this.waiters.delete(waiter);
            waiter.resolve(frame);
            delivered = true;
            break;
          }
          if (!delivered) this.frames.push(frame);
        }
      }
    }
    this.finish(1006);
  }

  next(matches: (frame: RelayFrame) => boolean): Promise<RelayFrame> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const index = this.frames.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.frames.splice(index, 1)[0]!);
    if (this.ended) return Promise.reject(new Error('SSE connection is closed'));
    return new Promise<RelayFrame>((resolve, reject) => {
      const waiter: FrameWaiter = { matches, resolve, reject, timer: setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('Expected SSE relay frame did not arrive'));
      }, 2000) };
      this.waiters.add(waiter);
    });
  }

  sessionSecret(): string {
    if (this.secret === null) throw new Error('SSE session was not announced');
    return this.secret;
  }

  post(frames: readonly Record<string, unknown>[], flags: { readonly ping?: boolean; readonly bye?: boolean } = {}): Promise<Response> {
    return SELF.fetch(`https://relay.test/api/tables/${this.table.code}/stream/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: streamSendBody(this.sessionSecret(), frames.map((frame) => JSON.stringify({ v: 1, ...frame })), flags),
    });
  }

  async close(): Promise<void> {
    if (!this.ended) {
      this.finish(1000);
      await this.reader.cancel();
    }
    await this.reading;
  }

  private finish(code: number): void {
    if (this.ended) return;
    this.ended = true;
    this.resolveClose(code);
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(this.failure ?? new Error(`SSE closed with ${code}`));
    }
    this.waiters.clear();
  }
}

export async function openStream(table: TestTable, hello: Record<string, unknown>): Promise<StreamPeer> {
  const response = await SELF.fetch(`https://relay.test/api/tables/${table.code}/stream`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, t: 'hello', role: 'player', name: 'SSE player', waits: true, ...hello }),
  });
  if (response.status !== 200 || response.body === null) throw new Error(`SSE open failed: ${response.status}`);
  return new StreamPeer(table, response.body.getReader());
}
