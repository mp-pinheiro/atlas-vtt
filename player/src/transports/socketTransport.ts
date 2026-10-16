import { KEEPALIVE_PONG, parseRelayFrame, type PlayerHello, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import type { ConnectionTimers } from '../state/interfaces.ts';

export interface TransportCallbacks {
  readonly close: (code: number, reason: string) => void;
  readonly frame: (frame: RelayFrame) => void;
  readonly pong?: () => void;
  readonly opened: () => void;
  readonly waiting: (wait?: string) => void;
}

const socketTimers: Pick<ConnectionTimers, 'setTimeout' | 'clearTimeout'> = {
  setTimeout(callback, delay) { return globalThis.setTimeout(callback, delay); },
  clearTimeout(handle) { globalThis.clearTimeout(handle as number); },
};

export class SocketTransport {
  private socket: WebSocket | null = null;
  private openTimer: unknown = null;
  private fallbackSent = false;

  constructor(
    private readonly origin: string,
    private readonly table: string,
    private readonly onOpenFailure: () => void,
    private readonly timers: Pick<ConnectionTimers, 'setTimeout' | 'clearTimeout'> = socketTimers,
  ) {}

  connect(hello: PlayerHello, callbacks: TransportCallbacks): void {
    this.close();
    this.fallbackSent = false;
    const url = new URL(`/api/tables/${this.table}/socket`, this.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    let opened = false;
    const failOpen = (): void => {
      if (this.socket !== socket || opened || this.fallbackSent) return;
      this.fallbackSent = true;
      this.clearOpenTimer();
      this.onOpenFailure();
      socket.close();
    };
    this.openTimer = this.timers.setTimeout(failOpen, 10_000);
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      opened = true;
      this.clearOpenTimer();
      socket.send(JSON.stringify(hello));
      callbacks.opened();
    }, { once: true });
    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== socket) return;
      if (event.data === KEEPALIVE_PONG) { callbacks.pong?.(); return; }
      if (typeof event.data !== 'string') { socket.close(4006, 'protocol'); return; }
      const frame = parseRelayFrame(event.data);
      if (!frame) { socket.close(4006, 'protocol'); return; }
      if (frame.t === 'waiting') callbacks.waiting(frame.wait);
      callbacks.frame(frame);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.socket !== socket) return;
      if (!opened) { failOpen(); return; }
      this.clearOpenTimer();
      callbacks.close(event.code, event.reason);
    }, { once: true });
    socket.addEventListener('error', failOpen);
  }

  send(text: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Socket is not open');
    this.socket.send(text);
  }

  close(): void {
    this.clearOpenTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private clearOpenTimer(): void {
    if (this.openTimer === null) return;
    this.timers.clearTimeout(this.openTimer);
    this.openTimer = null;
  }
}
