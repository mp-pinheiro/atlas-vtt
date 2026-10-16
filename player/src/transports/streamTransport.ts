import { parseRelayFrame, type PlayerHello } from '../../../src/app/online/protocol/relay.ts';
import { StreamReader, streamPath, streamSendBody, streamSendPath, type StreamLine } from '../../../src/app/online/protocol/stream.ts';
import type { TransportCallbacks } from './socketTransport.ts';

export class StreamTransport {
  private controller: AbortController | null = null;
  private secret: string | null = null;
  private sendTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private pending = 0;
  get busy(): boolean { return this.pending > 0; }

  connect(origin: string, table: string, hello: PlayerHello, callbacks: TransportCallbacks): void {
    this.close();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    void this.read(origin, table, hello, callbacks, controller, generation);
  }

  private async read(origin: string, table: string, hello: PlayerHello, callbacks: TransportCallbacks, controller: AbortController, generation: number): Promise<void> {
    try {
      const response = await fetch(new URL(streamPath(table), origin), { method: 'POST', body: JSON.stringify(hello), signal: controller.signal });
      if (!response.ok || !response.body) { callbacks.close(response.status === 404 ? 4008 : 1006, 'stream unavailable'); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const parser = new StreamReader();
      while (generation === this.generation) {
        const part = await reader.read();
        if (generation !== this.generation) return;
        if (part.done) break;
        let lines: StreamLine[] | null;
        try { lines = parser.read(decoder.decode(part.value, { stream: true })); }
        catch { callbacks.close(4006, 'protocol'); return; }
        if (!lines) { callbacks.close(4006, 'protocol'); return; }
        for (const line of lines) {
          if (generation !== this.generation) return;
          if (line.kind === 'session') {
            if (this.secret !== null) { callbacks.close(4006, 'protocol'); return; }
            this.secret = line.secret;
            callbacks.opened();
          }
          else if (line.kind === 'pong') callbacks.pong?.();
          else if (line.kind === 'frame') {
            if (this.secret === null) { callbacks.close(4006, 'protocol'); return; }
            const frame = parseRelayFrame(line.text);
            if (!frame) { callbacks.close(4006, 'protocol'); return; }
            if (frame.t === 'waiting') callbacks.waiting(frame.wait);
            callbacks.frame(frame);
          } else if (line.kind === 'close') { callbacks.close(line.code, line.reason); return; }
        }
      }
      if (generation === this.generation) callbacks.close(1006, 'stream ended');
    } catch {
      if (generation === this.generation && !controller.signal.aborted) callbacks.close(1006, 'stream failed');
    }
  }

  send(origin: string, table: string, text: string): Promise<void> {
    const secret = this.secret;
    if (!secret) return Promise.reject(new Error('Stream is not ready'));
    if (this.pending >= 128) return Promise.reject(new Error('Stream send queue is full'));
    this.pending++;
    const generation = this.generation;
    const post = async (): Promise<void> => {
      if (generation !== this.generation) throw new Error('Stream generation changed');
      const response = await fetch(new URL(streamSendPath(table), origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: streamSendBody(secret, [text]), signal: this.controller?.signal });
      if (!response.ok) throw new Error(`Stream send failed: ${response.status}`);
    };
    const result = this.sendTail.then(post);
    this.sendTail = result.catch((error: unknown) => {
      if (generation === this.generation) this.close();
      throw error;
    });
    void this.sendTail.catch(() => undefined);
    return result.finally(() => { if (generation === this.generation) this.pending--; });
  }

  ping(origin: string, table: string): Promise<void> {
    const secret = this.secret;
    if (!secret) return Promise.reject(new Error('Stream is not ready'));
    this.pending++;
    const generation = this.generation;
    const post = async (): Promise<void> => {
      if (generation !== this.generation) throw new Error('Stream generation changed');
      const response = await fetch(new URL(streamSendPath(table), origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: streamSendBody(secret, [], { ping: true }), signal: this.controller?.signal });
      if (!response.ok) throw new Error(`Stream ping failed: ${response.status}`);
    };
    const result = this.sendTail.then(post);
    this.sendTail = result.catch((error: unknown) => {
      if (generation === this.generation) this.close();
      throw error;
    });
    void this.sendTail.catch(() => undefined);
    return result.finally(() => { if (generation === this.generation) this.pending--; });
  }
  close(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.secret = null;
    this.sendTail = Promise.resolve();
    this.pending = 0;
  }
}
