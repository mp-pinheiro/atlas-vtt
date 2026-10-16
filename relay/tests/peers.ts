import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { parseRelayFrame, SECRET_PATTERN, TABLE_CODE_PATTERN, type RelayFrame } from '../../src/app/online/protocol/relay.ts';

export interface TestTable {
  readonly code: string;
  readonly secret: string;
  readonly maxPlayers: number;
}

export async function createTable(): Promise<TestTable> {
  const response = await SELF.fetch('https://relay.test/api/tables', { method: 'POST', headers: { authorization: `Bearer ${env.HOST_KEY}` } });
  const table = await response.json() as TestTable;
  if (response.status !== 201 || !TABLE_CODE_PATTERN.test(table.code) || !SECRET_PATTERN.test(table.secret) || table.maxPlayers !== 12) throw new Error(`Table creation failed: ${response.status}`);
  return table;
}

interface Waiter {
  readonly matches: (frame: RelayFrame) => boolean;
  readonly resolve: (frame: RelayFrame) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: number;
}

export class Peer {
  private readonly frames: RelayFrame[] = [];
  private readonly waiters = new Set<Waiter>();
  readonly closed: Promise<number>;
  private resolveClose: (code: number) => void = (): void => { throw new Error('Close observer not initialized'); };
  private failure: Error | null = null;

  constructor(readonly socket: WebSocket) {
    this.closed = new Promise<number>((resolve) => { this.resolveClose = resolve; });
    socket.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      const frame = typeof event.data === 'string' ? parseRelayFrame(event.data) : null;
      if (frame === null) {
        this.failure = new Error('Relay sent a malformed frame');
        for (const waiter of this.waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(this.failure);
        }
        this.waiters.clear();
        return;
      }
      for (const waiter of this.waiters) {
        if (!waiter.matches(frame)) continue;
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(frame);
        return;
      }
      this.frames.push(frame);
    });
    socket.addEventListener('close', (event) => {
      this.resolveClose(event.code);
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`Relay closed with ${event.code}`));
      }
      this.waiters.clear();
    });
    socket.accept();
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ v: 1, ...frame }));
  }

  next(matches: (frame: RelayFrame) => boolean): Promise<RelayFrame> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const index = this.frames.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.frames.splice(index, 1)[0]!);
    return new Promise<RelayFrame>((resolve, reject) => {
      const waiter: Waiter = { matches, resolve, reject, timer: setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('Expected relay frame did not arrive'));
      }, 2000) };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'test finished');
  }
}

export async function connect(table: TestTable): Promise<Peer> {
  const response = await SELF.fetch(`https://relay.test/api/tables/${table.code}/socket`, { headers: { upgrade: 'websocket' } });
  if (response.status !== 101 || response.webSocket === null) throw new Error(`Socket upgrade failed: ${response.status}`);
  return new Peer(response.webSocket);
}

export async function host(table: TestTable, ask = false): Promise<Peer> {
  const peer = await connect(table);
  peer.send({ t: 'hello', role: 'gm', secret: table.secret });
  await peer.next((frame) => frame.t === 'welcome' && frame.role === 'gm');
  peer.send({ t: 'gate', code: '483912', ask });
  return peer;
}

export async function join(table: TestTable, name: string, credential: { readonly key?: string; readonly wait?: string; readonly code?: string } = { code: '483912' }): Promise<Peer> {
  const peer = await connect(table);
  peer.send({ t: 'hello', role: 'player', name, waits: true, ...credential });
  return peer;
}
