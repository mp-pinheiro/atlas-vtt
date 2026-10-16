import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index.ts';
import { SOCKET_RATE } from './limits.ts';
import { CLOSE, KEEPALIVE_PING, KEEPALIVE_PONG, type PlayerInfo } from '../../src/app/online/protocol/relay.ts';
import { initializeTable, readMeta, waiting, writeMeta, type TableConfig } from './tableState.ts';
import { attachment, closeSocket, type Attachment } from './connections.ts';
import { sha256 } from './credentials.ts';
import { StreamSessions } from './streamSession.ts';
import { TableGateway, type TableGatewayHost } from './tableGateway.ts';

export class Table extends DurableObject<Env> {
  private readonly streams = new StreamSessions();
  private readonly gateway: TableGateway;
  private initialized = false;
  private ended = false;
  private deletion: Promise<void> | null = null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const gatewayHost: TableGatewayHost = {
      ctx: this.ctx,
      env: this.env,
      streams: this.streams,
      live: () => this.live(),
      generationCurrent: (state) => this.generationCurrent(state),
      playerGenerationIsCurrent: (id, generation) => this.playerGenerationIsCurrent(id, generation),
      waitingGenerationIsCurrent: (id, generation) => this.waitingGenerationIsCurrent(id, generation),
      clearStreamGeneration: (id, generation) => this.clearStreamGeneration(id, generation),
      nextGeneration: () => this.nextGeneration(),
      consumeFrame: (socket, state) => this.consumeFrame(socket, state),
      connectedPlayers: () => this.connectedPlayers(),
      gmSocket: () => this.gmSocket(),
      send: (socket, frame) => this.send(socket, frame),
      broadcast: (frame, role) => this.broadcast(frame, role),
      reschedule: () => this.reschedule(),
      end: (code, reason) => this.end(code, reason),
    };
    this.gateway = new TableGateway(gatewayHost);
    const hasMeta = ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
    const ending = hasMeta ? readMeta(ctx.storage, 'ending') : null;
    this.ended = ending !== null;
    this.initialized = ending === null && hasMeta && readMeta(ctx.storage, 'secretHash') !== null;
    if (ending !== null) ctx.blockConcurrencyWhile(() => this.end(Number(ending), 'ended'));
    if (this.initialized) {
      ctx.storage.sql.exec('DELETE FROM active_players');
      for (const socket of ctx.getWebSockets()) {
        const state = attachment(socket);
        if (socket.readyState === WebSocket.OPEN && state?.role === 'player' && state.id) {
          ctx.storage.sql.exec('INSERT INTO active_players(id,generation) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET generation=MAX(active_players.generation,excluded.generation)', state.id, state.generation);
        }
      }
      if (this.gmSocket() === null && readMeta(ctx.storage, 'gmAwayAt') === null) writeMeta(ctx.storage, 'gmAwayAt', String(Date.now()));
      ctx.blockConcurrencyWhile(async () => {
        const fingerprint = env.HOST_KEY === undefined ? null : await sha256(env.HOST_KEY);
        if (fingerprint !== readMeta(ctx.storage, 'hostFingerprint')) await this.end(CLOSE.noAccess, 'no access');
        else await this.reschedule();
      });
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/initialize' && request.method === 'POST') {
      if (this.ended) return new Response(null, { status: 409 });
      const config = await request.json() as TableConfig;
      return this.ctx.blockConcurrencyWhile(async () => {
        if (this.ended) return new Response(null, { status: 409 });
        await initializeTable(this.ctx.storage, config);
        const wasInitialized = this.initialized;
        this.initialized = true;
        if (!wasInitialized) writeMeta(this.ctx.storage, 'gmAwayAt', String(config.createdAt));
        await this.reschedule();
        return new Response(null, { status: 204 });
      });
    }
    if (path === '/end' && request.method === 'POST') {
      const code = Number(request.headers.get('x-close-code')) || CLOSE.ended;
      await this.end(code, code === CLOSE.superseded ? 'superseded' : 'ended');
      return new Response(null, { status: 204 });
    }
    if (path.endsWith('/socket') && !this.live()) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      closeSocket(server, CLOSE.ended, 'ended');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!this.live()) return new Response(null, { status: 410 });
    if (path.endsWith('/stream/send')) return this.gateway.streamSend(request);
    if (path.endsWith('/stream')) return this.gateway.openStream(request);
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
    if (this.ctx.getWebSockets().filter((socket) => attachment(socket)?.role === 'pending' && !attachment(socket)?.id).length >= 32) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      closeSocket(server, CLOSE.rateLimited, 'rate limited');
      return new Response(null, { status: 101, webSocket: client });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ role: 'pending', generation: this.nextGeneration(), deadline: now + 10_000, tokens: 0, updatedAt: now } satisfies Attachment);
    await this.reschedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ctx.blockConcurrencyWhile(() => this.gateway.receiveSocket(socket, message));
  }


  async webSocketClose(socket: WebSocket, code = 1000, reason = 'closed'): Promise<void> {
    closeSocket(socket, code === 1005 ? 1000 : code, reason);
    await this.ctx.blockConcurrencyWhile(() => this.closeConnection(socket));
  }

  private async closeConnection(socket: WebSocket): Promise<void> {
    if (!this.live()) return;
    const state = attachment(socket);
    if (!state || !this.generationCurrent(state)) {
      await this.reschedule();
      return;
    }
    if (state.role === 'pending' && state.id) this.ctx.storage.sql.exec('UPDATE waiting SET active_generation = NULL WHERE id = ? AND active_generation = ?', state.id, state.generation);
    if (state.role === 'player' && state.id) this.ctx.storage.sql.exec('DELETE FROM active_players WHERE id = ? AND generation = ?', state.id, state.generation);
    if (state.role === 'gm') {
      writeMeta(this.ctx.storage, 'gmGeneration', null);
      writeMeta(this.ctx.storage, 'gmAwayAt', String(Date.now()));
      this.broadcast({ v: 1, t: 'gm', online: false }, 'player');
    }
    if (state.role === 'player' && state.id && !this.connectedPlayers().some((person) => person.id === state.id)) this.broadcast({ v: 1, t: 'player-left', id: state.id }, 'gm');
    await this.reschedule();
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(() => this.expire());
  }

  private async expire(): Promise<void> {
    if (!this.live()) return;
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const state = attachment(socket);
      if (socket.readyState !== WebSocket.OPEN || state?.role !== 'pending') continue;
      if (now >= state.deadline) closeSocket(socket, state.id ? CLOSE.noAnswer : CLOSE.protocol, state.id ? 'no answer' : 'hello timeout');
    }
    for (const record of waiting(this.ctx.storage)) {
      if (now >= record.deadline) {
        this.ctx.storage.sql.exec('DELETE FROM waiting WHERE id = ?', record.id);
        if (!record.admitted) {
          this.broadcast({ v: 1, t: 'knock-gone', id: record.id }, 'gm');
          this.streams.closePlayer(record.id, CLOSE.noAnswer, 'no answer');
        }
      }
    }
    this.streams.expire(now);
    const away = readMeta(this.ctx.storage, 'gmAwayAt');
    if (away !== null && now >= Number(away) + 24 * 60 * 60 * 1000) {
      await this.end(CLOSE.ended, 'ended');
      return;
    }
    await this.reschedule();
  }

  async end(code: number, reason: string): Promise<void> {
    if (this.deletion !== null) return this.deletion;
    if (this.initialized) writeMeta(this.ctx.storage, 'ending', String(code));
    this.ended = true;
    this.initialized = false;
    this.streams.closeAll(code, reason);
    for (const socket of this.ctx.getWebSockets()) closeSocket(socket, code, reason);
    this.deletion = this.ctx.storage.deleteAll();
    try {
      await this.deletion;
    } catch (error) {
      this.deletion = null;
      throw error;
    }
  }

  private live(): boolean {
    return this.initialized && !this.ended;
  }

  private nextGeneration(): number {
    const generation = Number(readMeta(this.ctx.storage, 'generation') ?? 0) + 1;
    writeMeta(this.ctx.storage, 'generation', String(generation));
    return generation;
  }

  private async reschedule(): Promise<void> {
    if (!this.live()) return;
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const state = attachment(socket);
      if (socket.readyState === WebSocket.OPEN && state?.role === 'pending' && (!state.id || this.generationCurrent(state))) next = Math.min(next, state.deadline);
    }
    for (const record of waiting(this.ctx.storage)) next = Math.min(next, record.deadline);
    const stream = this.streams.nextDeadline();
    if (stream !== null) next = Math.min(next, stream);
    const away = readMeta(this.ctx.storage, 'gmAwayAt');
    if (away !== null) next = Math.min(next, Number(away) + 24 * 60 * 60 * 1000);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  private send(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }
  private broadcast(frame: unknown, role: 'gm' | 'player'): void {
    for (const socket of this.ctx.getWebSockets()) {
      const state = attachment(socket);
      if (state?.role === role && this.generationCurrent(state)) this.send(socket, frame);
    }
    if (role === 'player') this.streams.publish('*', frame);
  }

  private gmSocket(): WebSocket | null {
    for (const socket of this.ctx.getWebSockets()) {
      const state = attachment(socket);
      if (socket.readyState === WebSocket.OPEN && state?.role === 'gm' && this.generationCurrent(state)) return socket;
    }
    return null;
  }

  private connectedPlayers(): PlayerInfo[] {
    const players: PlayerInfo[] = [];
    const seen = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const state = attachment(socket);
      if (socket.readyState === WebSocket.OPEN && state?.role === 'player' && state.id && state.name && this.generationCurrent(state) && !seen.has(state.id)) {
        seen.add(state.id);
        players.push({ id: state.id, name: state.name });
      }
    }
    for (const player of this.streams.people()) {
      if (seen.has(player.id)) continue;
      seen.add(player.id);
      players.push(player);
    }
    return players;
  }

  private waitingGenerationIsCurrent(id: string, generation: number): boolean {
    if (!this.live()) return false;
    const row = this.ctx.storage.sql.exec<{ activeGeneration: number | null }>('SELECT active_generation AS activeGeneration FROM waiting WHERE id = ?', id).toArray()[0];
    return row?.activeGeneration === generation && readMeta(this.ctx.storage, 'ended') !== '1';
  }

  private playerGenerationIsCurrent(id: string, generation: number): boolean {
    if (!this.live()) return false;
    const row = this.ctx.storage.sql.exec<{ generation: number }>('SELECT generation FROM active_players WHERE id = ?', id).toArray()[0];
    return row?.generation === generation && readMeta(this.ctx.storage, 'ended') !== '1';
  }

  private clearStreamGeneration(id: string, generation: number): void {
    if (!this.live()) return;
    this.ctx.storage.sql.exec('UPDATE waiting SET active_generation = NULL WHERE id = ? AND active_generation = ?', id, generation);
    if (this.playerGenerationIsCurrent(id, generation)) {
      this.ctx.storage.sql.exec('DELETE FROM active_players WHERE id = ? AND generation = ?', id, generation);
      if (!this.connectedPlayers().some((person) => person.id === id)) this.broadcast({ v: 1, t: 'player-left', id }, 'gm');
    }
    this.ctx.waitUntil(this.reschedule());
  }


  private generationCurrent(state: Attachment): boolean {
    if (!this.live()) return false;
    if (state.role === 'gm') return readMeta(this.ctx.storage, 'gmGeneration') === String(state.generation);
    if (state.role === 'pending' && state.id) return this.waitingGenerationIsCurrent(state.id, state.generation);
    if (state.role !== 'player' || !state.id) return false;
    return this.playerGenerationIsCurrent(state.id, state.generation);
  }

  private consumeFrame(socket: WebSocket, state: Attachment): boolean {
    const now = Date.now();
    const burst = state.role === 'gm' ? SOCKET_RATE.gmBurst : SOCKET_RATE.playerBurst;
    const rate = state.role === 'gm' ? SOCKET_RATE.gmPerSecond : SOCKET_RATE.playerPerSecond;
    const available = Math.min(burst, Math.max(0, state.tokens) + Math.max(0, now - state.updatedAt) * rate / 1000);
    if (available < 1) return false;
    socket.serializeAttachment({ ...state, tokens: available - 1, updatedAt: now });
    return true;
  }
}
