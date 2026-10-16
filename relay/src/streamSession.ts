import { CLOSE, MAX_PLAYER_FRAME, isOtherVersion, parseClientFrame, type ClientFrame, type PlayerInfo } from '../../src/app/online/protocol/relay.ts';
import { BEAT_LINE, closeLine, frameLine, PONG_LINE, sessionLine, parseStreamSend, STREAM_CONTENT_TYPE } from '../../src/app/online/protocol/stream.ts';
import { STREAM_IDLE_MS, STREAM_MAX_BUFFER, utf8Size } from './limits.ts';
import { secret, sha256 } from './credentials.ts';

type PlayerSend = Extract<ClientFrame, { readonly t: 'send' }>;

interface Session {
  readonly hash: string;
  readonly id: string | null;
  readonly name: string;
  readonly generation: number;
  admitted: boolean;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly encoder: TextEncoder;
  readonly onFrame: ((frame: PlayerSend) => Promise<void>) | null;
  readonly onClose: ((id: string, generation: number) => void) | null;
  readonly isCurrent: () => boolean;
  readonly pendingBytes: number[];
  lastActivity: number;
  busy: boolean;
  tokens: number;
  updatedAt: number;
  queuedBytes: number;
  timer: number;
}

interface OpenedStream {
  readonly response: Response;
  readonly session: Session | null;
}

export class StreamSessions {
  private readonly sessions = new Map<string, Session>();

  async open(id: string, name: string, generation: number, admitted: boolean, onFrame: Session['onFrame'], frames: readonly unknown[], signal: AbortSignal, onClose: Session['onClose'], isCurrent: Session['isCurrent']): Promise<Response> {
    return (await this.create(id, name, generation, admitted, onFrame, frames, signal, onClose, isCurrent)).response;
  }

  async reject(code: number, reason: string, generation: number, signal: AbortSignal, isCurrent: Session['isCurrent']): Promise<Response> {
    const opened = await this.create(null, '', generation, false, null, [], signal, null, isCurrent);
    if (opened.session !== null) this.remove(opened.session, code, reason);
    return opened.response;
  }

  private async create(id: string | null, name: string, generation: number, admitted: boolean, onFrame: Session['onFrame'], frames: readonly unknown[], signal: AbortSignal, onClose: Session['onClose'], isCurrent: Session['isCurrent']): Promise<OpenedStream> {
    const token = secret();
    const hash = await sha256(token);
    if (!isCurrent()) return { response: new Response(null, { status: 409 }), session: null };
    let session: Session | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (controller): void => {
        const now = Date.now();
        const active: Session = { hash, id, name, generation, admitted, controller, encoder: new TextEncoder(), onFrame, onClose, isCurrent, pendingBytes: [], lastActivity: now, busy: false, tokens: 300, updatedAt: now, queuedBytes: 0, timer: setInterval(() => this.tick(active), 15_000) };
        session = active;
        this.sessions.set(hash, active);
        this.enqueue(active, sessionLine(token));
        for (const frame of frames) this.enqueue(active, frameLine(JSON.stringify(frame)));
      },
      pull: (): void => {
        const bytes = session?.pendingBytes.shift();
        if (session && bytes !== undefined) session.queuedBytes -= bytes;
      },
      cancel: (): void => { if (session) this.remove(session, CLOSE.ended, 'closed'); },
    });
    signal.addEventListener('abort', () => { if (session) this.remove(session, CLOSE.ended, 'closed'); }, { once: true });
    if (signal.aborted && session) this.remove(session, CLOSE.ended, 'closed');
    return { response: new Response(body, { status: 200, headers: { 'content-type': STREAM_CONTENT_TYPE, 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } }), session };
  }

  people(): PlayerInfo[] {
    const people: PlayerInfo[] = [];
    const seen = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.id === null || !session.isCurrent() || !session.admitted || seen.has(session.id)) continue;
      seen.add(session.id);
      people.push({ id: session.id, name: session.name });
    }
    return people;
  }

  admitPlayer(id: string, generation: number): void {
    for (const session of this.sessions.values()) {
      if (session.id === id && session.generation === generation) session.admitted = true;
    }
  }
  generationOf(id: string): number | null {
    for (const session of this.sessions.values()) if (session.id === id && session.isCurrent()) return session.generation;
    return null;
  }

  publish(recipient: string, frame: unknown): void {
    for (const session of this.sessions.values()) {
      if (!session.isCurrent() || (!session.admitted && !(typeof frame === 'object' && frame !== null && 't' in frame && (frame.t === 'welcome' || frame.t === 'knock-gone'))) || (recipient !== '*' && session.id !== recipient)) continue;
      this.enqueue(session, frameLine(JSON.stringify(frame)));
    }
  }

  closePlayer(id: string, code: number, reason: string): void {
    for (const session of this.sessions.values()) if (session.id === id) this.remove(session, code, reason);
  }

  replacePlayer(id: string): void {
    this.closePlayer(id, CLOSE.replaced, 'replaced');
  }

  async send(text: string): Promise<Response> {
    if (utf8Size(text) > 64 * 1024) return new Response(null, { status: 413 });
    const parsed = parseStreamSend(text);
    if (!parsed) return new Response(null, { status: 400 });
    const hash = await sha256(parsed.s);
    const session = this.sessions.get(hash);
    if (!session) return new Response(null, { status: 410 });
    if (!session.isCurrent()) {
      this.remove(session, CLOSE.replaced, 'replaced');
      return new Response(null, { status: 410 });
    }
    if (session.busy) return new Response(null, { status: 409 });
    session.busy = true;
    try {
      if (Date.now() - session.lastActivity >= STREAM_IDLE_MS) {
        this.remove(session, 1001, 'inactive');
        return new Response(null, { status: 410 });
      }
      const accepted: PlayerSend[] = [];
      for (const textFrame of parsed.frames) {
        if (utf8Size(textFrame) > MAX_PLAYER_FRAME) {
          this.remove(session, CLOSE.tooLarge, 'too large');
          return new Response(null, { status: 413 });
        }
        const frame = parseClientFrame(textFrame);
        if (!frame) {
          this.remove(session, isOtherVersion(textFrame) ? CLOSE.version : CLOSE.protocol, 'invalid player frame');
          return new Response(null, { status: 400 });
        }
        if (frame.t !== 'send' || frame.to !== undefined) {
          this.remove(session, CLOSE.protocol, 'invalid player frame');
          return new Response(null, { status: 400 });
        }
        accepted.push(frame);
      }
      if (!session.admitted && accepted.length > 0) {
        this.remove(session, CLOSE.protocol, 'join pending');
        return new Response(null, { status: 400 });
      }
      const now = Date.now();
      const available = Math.min(300, session.tokens + Math.max(0, now - session.updatedAt) * 150 / 1000);
      if (available < accepted.length) {
        this.remove(session, CLOSE.rateLimited, 'rate limited');
        return new Response(null, { status: 429 });
      }
      session.tokens = available - accepted.length;
      session.updatedAt = now;
      for (const frame of accepted) {
        if (!session.onFrame) {
          this.remove(session, CLOSE.protocol, 'player action unavailable');
          return new Response(null, { status: 400 });
        }
        await session.onFrame(frame);
      }
      session.lastActivity = Date.now();
      if (parsed.ping) this.enqueue(session, PONG_LINE);
      if (parsed.bye) this.remove(session, CLOSE.ended, 'closed');
      return new Response(null, { status: 204 });
    } finally {
      session.busy = false;
    }
  }

  private tick(session: Session): void {
    if (Date.now() - session.lastActivity >= STREAM_IDLE_MS) this.remove(session, 1001, 'inactive');
    else this.enqueue(session, BEAT_LINE);
  }
  expire(now: number): number | null {
    let next = Infinity;
    for (const session of this.sessions.values()) {
      const deadline = session.lastActivity + STREAM_IDLE_MS;
      if (now >= deadline) this.remove(session, 1001, 'inactive');
      else next = Math.min(next, deadline);
    }
    return Number.isFinite(next) ? next : null;
  }

  nextDeadline(): number | null {
    let next = Infinity;
    for (const session of this.sessions.values()) next = Math.min(next, session.lastActivity + STREAM_IDLE_MS);
    return Number.isFinite(next) ? next : null;
  }

  private enqueue(session: Session, value: string): void {
    const bytes = session.encoder.encode(value);
    if (session.queuedBytes + bytes.byteLength > STREAM_MAX_BUFFER) {
      this.remove(session, CLOSE.rateLimited, 'slow consumer');
      return;
    }
    try {
      session.queuedBytes += bytes.byteLength;
      session.pendingBytes.push(bytes.byteLength);
      session.controller.enqueue(bytes);
    } catch {
      this.remove(session, CLOSE.ended, 'closed');
    }
  }

  private remove(session: Session, code: number, reason: string): void {
    if (this.sessions.get(session.hash) !== session) return;
    this.sessions.delete(session.hash);
    clearInterval(session.timer);
    if (session.id !== null) session.onClose?.(session.id, session.generation);
    try {
      session.controller.enqueue(session.encoder.encode(closeLine(code, reason)));
      session.controller.close();
    } catch {
      return;
    }
  }
  closeAll(code: number, reason: string): void {
    for (const session of this.sessions.values()) this.remove(session, code, reason);
  }
}
