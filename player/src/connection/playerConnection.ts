import { FINAL_CLOSE_CODES, GATE_CLOSE_CODES, KEEPALIVE_PING, JOIN_CODE_PATTERN, MAX_PLAYER_FRAME, TABLE_CODE_PATTERN, playerName, type PlayerHello, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import { parsePlayerMessage, type PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { SocketTransport } from '../transports/socketTransport.ts';
import { StreamTransport } from '../transports/streamTransport.ts';
import { playerIdentity, type IdentityStorage } from '../storage/playerIdentity.ts';
import type { ConnectionTimers, PlayerConnectionApi } from '../state/interfaces.ts';
import type { PlayerIdentity, PlayerStatus } from '../state/playerStore.ts';
import { playerText } from '../i18n.ts';

export interface PlayerConnectionOptions {
  readonly origin: string;
  readonly table: string;
  readonly identity?: IdentityStorage;
  readonly timers?: ConnectionTimers;
  readonly socket?: (origin: string, table: string, onOpenFailure: () => void) => SocketTransport;
  readonly stream?: () => StreamTransport;
  readonly onStatus: (status: PlayerStatus, notice: string | null) => void;
  readonly onFrame: (frame: RelayFrame) => void;
  readonly onReady?: () => void;
  readonly onForget?: (identity: PlayerIdentity) => Promise<void>;
  readonly onTransportGeneration?: () => void;
}

const systemTimers: ConnectionTimers = {
  setTimeout(callback, delay) { return globalThis.setTimeout(callback, delay); },
  clearTimeout(handle) { globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>); },
  setInterval(callback, delay) { return globalThis.setInterval(callback, delay); },
  clearInterval(handle) { globalThis.clearInterval(handle as ReturnType<typeof setInterval>); },
  now() { return Date.now(); },
  random() { return Math.random(); },
};

export class PlayerConnection implements PlayerConnectionApi {
  private readonly timers: ConnectionTimers;
  private readonly identity: IdentityStorage;
  private readonly socketFactory: NonNullable<PlayerConnectionOptions['socket']>;
  private readonly streamFactory: NonNullable<PlayerConnectionOptions['stream']>;
  private socket: SocketTransport | null = null;
  private stream: StreamTransport | null = null;
  private hello: PlayerHello | null = null;
  private generation = 0;
  private attempts = 0;
  private stopped = true;
  private opened = false;
  private welcomed = false;
  private gmOnline = false;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private retryTimer: unknown = null;
  private lastPing = 0;
  private streamMode = false;
  private identityNotice: string | null = null;

  constructor(private readonly options: PlayerConnectionOptions) {
    this.timers = options.timers ?? systemTimers;
    this.identity = options.identity ?? playerIdentity(options.table);
    this.socketFactory = options.socket ?? ((origin, table, onOpenFailure) => new SocketTransport(origin, table, onOpenFailure, this.timers));
    if (!this.identity.persistent) this.identityNotice = playerText('storageLost');
    this.streamFactory = options.stream ?? (() => new StreamTransport());
  }

  start(input: { readonly name: string; readonly code?: string }): void {
    this.stop();
    this.stopped = false;
    this.identityNotice = this.identity.persistent ? null : playerText('storageLost');
    this.attempts = 0;
    if (!TABLE_CODE_PATTERN.test(this.options.table)) {
      this.options.onStatus('invalid-table', playerText('invalidTable'));
      return;
    }
    const name = playerName(input.name);
    if (name === null) {
      this.options.onStatus('blocked', playerText('nameRequired'));
      return;
    }
    const saved = this.identity.get();
    if (!this.identity.persistent) this.identityNotice = playerText('storageLost');
    if (!saved.key && !saved.wait && input.code !== undefined && input.code !== '' && !JOIN_CODE_PATTERN.test(input.code)) {
      this.options.onStatus('blocked', playerText('codeRequired'));
      return;
    }
    const hello: PlayerHello = {
      v: 1, t: 'hello', role: 'player', name,
      ...(saved.key ? { key: saved.key } : saved.wait ? { wait: saved.wait } : input.code ? { code: input.code } : {}),
      waits: true,
    };
    this.hello = hello;
    this.connect(false);
  }
  canSend(): boolean {
    return this.optionsIdentityOnline() && (!this.streamMode || this.stream !== null && !this.stream.busy);
  }


  send(message: PlayerMessage): boolean {
    if (!this.welcomed || !this.optionsIdentityOnline()) return false;
    const parsed = parsePlayerMessage(message);
    if (!parsed) return false;
    const envelope = JSON.stringify({ v: 1, t: 'send', body: parsed });
    if (new TextEncoder().encode(envelope).byteLength > MAX_PLAYER_FRAME) return false;
    if (this.streamMode) {
      const stream = this.stream;
      if (!stream) return false;
      const generation = this.generation;
      void stream.send(this.options.origin, this.options.table, envelope).catch(() => { if (generation === this.generation) this.transportFailed(); });
      return true;
    }
    try {
      this.socket?.send(envelope);
      return this.socket !== null;
    } catch {
      this.transportFailed();
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.clearTimers();
    this.options.onTransportGeneration?.();
    this.stopTransport();
    this.welcomed = false;
    this.gmOnline = false;
  }

  async leaveAndForget(): Promise<void> {
    const forgottenIdentity = this.identity.get();
    this.stop();
    this.identity.clear();
    this.hello = null;
    await this.options.onForget?.(forgottenIdentity);
    this.options.onStatus('joining', null);
  }

  private optionsIdentityOnline(): boolean { return !this.stopped && this.welcomed && this.gmOnline; }

  private connect(useStream: boolean): void {
    if (this.stopped || this.hello === null) return;
    this.generation++;
    this.clearTimers();
    const generation = this.generation;
    this.options.onTransportGeneration?.();
    this.stopTransport();
    this.streamMode = useStream;
    this.opened = false;
    this.welcomed = false;
    this.gmOnline = false;
    this.options.onStatus(this.attempts === 0 ? 'joining' : 'disconnected', this.identityNotice);
    const callbacks = {
      opened: (): void => { if (generation === this.generation) this.opened = true; },
      pong: (): void => {
        if (generation === this.generation && this.pongTimer !== null) {
          this.timers.clearTimeout(this.pongTimer);
          this.pongTimer = null;
        }
      },
      waiting: (wait?: string): void => {
        if (generation !== this.generation) return;
        if (wait) {
          this.identity.set({ ...this.identity.get(), wait });
          this.hello = { ...this.hello as PlayerHello, wait, key: undefined, code: undefined };
        }
        this.options.onStatus('waiting', null);
      },
      frame: (frame: RelayFrame): void => {
        if (generation !== this.generation) return;
        if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
        this.pongTimer = null;
        this.frame(frame);
      },
      close: (code: number, reason: string): void => { if (generation === this.generation) this.closed(code, reason); },
    };
    try {
      if (useStream) {
        this.stream = this.streamFactory();
        this.stream.connect(this.options.origin, this.options.table, this.hello, callbacks);
      } else {
        this.socket = this.socketFactory(this.options.origin, this.options.table, () => {
          if (generation === this.generation && !this.opened) this.connect(true);
        });
        this.socket.connect(this.hello, callbacks);
      }
    } catch {
      if (generation !== this.generation) return;
      if (useStream) this.transportFailed();
      else this.connect(true);
    }
  }

  private frame(frame: RelayFrame): void {
    if (frame.t === 'welcome' && frame.role === 'player') {
      this.welcomed = true;
      this.gmOnline = frame.gmOnline;
      this.attempts = 0;
      if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.identity.set({ playerId: frame.id, key: frame.key });
      if (!this.identity.persistent) this.identityNotice = playerText('storageLost');
      if (this.hello) this.hello = { v: 1, t: 'hello', role: 'player', name: this.hello.name, key: frame.key, waits: true };
      this.startHeartbeat();
      if (frame.gmOnline) this.announceReady();
      if (!this.welcomed) return;
      this.options.onStatus(frame.gmOnline ? 'connected' : 'disconnected', this.identityNotice ?? (frame.gmOnline ? null : playerText('gmOffline')));
    } else if (frame.t === 'gm') {
      this.gmOnline = frame.online;
      if (!frame.online) {
        this.options.onStatus('disconnected', this.identityNotice ?? playerText('gmOffline'));
      } else if (this.identity.get().playerId) {
        this.welcomed = true;
        this.options.onTransportGeneration?.();
        this.announceReady();
        if (!this.welcomed) return;
        this.options.onStatus('connected', this.identityNotice);
      }
    } else if (frame.t === 'waiting') {
      if (frame.wait) {
        this.identity.set({ ...this.identity.get(), wait: frame.wait });
        if (!this.identity.persistent) this.identityNotice = playerText('storageLost');
        if (this.hello) this.hello = { v: 1, t: 'hello', role: 'player', name: this.hello.name, wait: frame.wait, waits: true };
      }
      this.options.onStatus('waiting', this.identityNotice);
    }
    this.options.onFrame(frame);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.lastPing = this.timers.now();
    this.pingTimer = this.timers.setInterval(() => {
      const now = this.timers.now();
      if (now - this.lastPing < 30_000) return;
      if (this.pongTimer !== null) return;
      this.lastPing = now;
      try {
        if (this.streamMode) {
          const generation = this.generation;
          if (this.stream) void this.stream.ping(this.options.origin, this.options.table).catch(() => { if (generation === this.generation) this.transportFailed(); });
        } else {
          this.socket?.send(KEEPALIVE_PING);
        }
      } catch {
        this.transportFailed();
        return;
      }
      const generation = this.generation;
      const due = this.timers.now() + 20_000;
      this.pongTimer = this.timers.setTimeout(() => {
        if (generation !== this.generation) return;
        if (this.timers.now() - due > 2_000) {
          this.pongTimer = this.timers.setTimeout(() => {
            if (generation === this.generation) this.transportFailed();
          }, 1_000);
        } else this.transportFailed();
      }, 20_000);
    }, 5_000);
  }

  private clearHeartbeat(): void {
    if (this.pingTimer !== null) this.timers.clearInterval(this.pingTimer);
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private announceReady(): void {
    if (this.send({ t: 'player-ready', agency: 1 }) && this.send({ t: 'book-parts' })) this.options.onReady?.();
  }

  private closed(code: number, reason: string): void {
    if (!GATE_CLOSE_CODES.includes(code) && !FINAL_CLOSE_CODES.includes(code)) {
      this.retry();
      return;
    }
    this.stopped = true;
    this.generation++;
    this.welcomed = false;
    this.gmOnline = false;
    this.clearTimers();
    this.stopTransport();
    this.options.onTransportGeneration?.();
    this.options.onStatus('blocked', playerText('connectionRefused', { reason }));
  }

  private transportFailed(): void { if (!this.stopped) this.retry(); }

  private retry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    this.generation++;
    this.welcomed = false;
    this.gmOnline = false;
    this.clearHeartbeat();
    this.stopTransport();
    this.options.onTransportGeneration?.();
    this.options.onStatus('disconnected', playerText('connectionLost'));
    const delay = Math.min(30_000, 500 * 2 ** this.attempts) * (0.5 + this.timers.random() / 2);
    this.attempts++;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.connect(false);
    }, delay);
  }

  private stopTransport(): void {
    this.socket?.close();
    this.stream?.close();
    this.socket = null;
    this.stream = null;
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) this.timers.clearInterval(this.pingTimer);
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.pongTimer = null;
    this.retryTimer = null;
  }
}
