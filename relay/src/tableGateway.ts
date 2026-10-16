import { CLOSE, MAX_GM_FRAME, MAX_PLAYER_FRAME, PROTOCOL_VERSION, isOtherVersion, parseClientFrame, type ClientFrame, type PlayerHello, type PlayerInfo } from '../../src/app/online/protocol/relay.ts';
import { MAX_STREAM_HELLO } from '../../src/app/online/protocol/stream.ts';
import { MAX_STREAM_BODY, SOCKET_RATE, readUtf8Body, utf8Size } from './limits.ts';
import { attachment, closeSocket, type Attachment } from './connections.ts';
import { authenticateHello } from './gates.ts';
import { readMeta, waiting, writeMeta } from './tableState.ts';
import { secret, sha256 } from './credentials.ts';
import { StreamSessions } from './streamSession.ts';
import type { Env } from './index.ts';

type PlayerSend = Extract<ClientFrame, { readonly t: 'send' }>;
type SocketRole = 'gm' | 'player';

export interface TableGatewayHost {
  readonly ctx: DurableObjectState;
  readonly env: Env;
  readonly streams: StreamSessions;
  live(): boolean;
  generationCurrent(state: Attachment): boolean;
  playerGenerationIsCurrent(id: string, generation: number): boolean;
  waitingGenerationIsCurrent(id: string, generation: number): boolean;
  clearStreamGeneration(id: string, generation: number): void;
  nextGeneration(): number;
  consumeFrame(socket: WebSocket, state: Attachment): boolean;
  connectedPlayers(): PlayerInfo[];
  gmSocket(): WebSocket | null;
  send(socket: WebSocket, frame: unknown): void;
  broadcast(frame: unknown, role: SocketRole): void;
  reschedule(): Promise<void>;
  end(code: number, reason: string): Promise<void>;
}

export class TableGateway {
  constructor(private readonly host: TableGatewayHost) {}

  async receiveSocket(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!this.host.live()) { closeSocket(socket, CLOSE.ended, 'ended'); return; }
    if (typeof message !== 'string') { closeSocket(socket, CLOSE.protocol, 'protocol'); return; }
    const state = attachment(socket);
    if (!state) { closeSocket(socket, CLOSE.protocol, 'protocol'); return; }
    if (utf8Size(message) > (state.role === 'gm' ? MAX_GM_FRAME : MAX_PLAYER_FRAME)) { closeSocket(socket, CLOSE.tooLarge, 'too large'); return; }
    if (state.role !== 'pending' && !this.host.consumeFrame(socket, state)) { closeSocket(socket, CLOSE.rateLimited, 'rate limited'); return; }
    if (state.role === 'pending') {
      if (state.id !== undefined || Date.now() >= state.deadline) { closeSocket(socket, CLOSE.protocol, 'hello required once'); return; }
      if (isOtherVersion(message)) { closeSocket(socket, CLOSE.version, 'version'); return; }
      const hello = parseClientFrame(message);
      if (!hello || hello.t !== 'hello') { closeSocket(socket, CLOSE.protocol, 'hello required'); return; }
      await this.hello(socket, state, hello);
      return;
    }
    const frame = parseClientFrame(message);
    if (!frame || frame.t === 'hello') { closeSocket(socket, isOtherVersion(message) ? CLOSE.version : CLOSE.protocol, 'protocol'); return; }
    const current = attachment(socket);
    if (!current || current.generation !== state.generation || !this.host.generationCurrent(current)) return;
    if (current.role === 'gm') await this.handleGm(socket, frame);
    else if (current.role === 'player' && current.id) await this.handlePlayer(socket, frame, current.id);
    else closeSocket(socket, CLOSE.protocol, 'protocol');
  }

  async streamSend(request: Request): Promise<Response> {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_STREAM_BODY) return new Response(null, { status: 413 });
    const text = await readUtf8Body(request, MAX_STREAM_BODY);
    if (!this.host.live()) return new Response(null, { status: 410 });
    if (text === null) return new Response(null, { status: 413 });
    const response = await this.host.streams.send(text);
    await this.host.reschedule();
    return response;
  }

  async openStream(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!this.host.live()) return new Response(null, { status: 410 });
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_STREAM_HELLO || length > MAX_PLAYER_FRAME) return new Response(null, { status: 413 });
    const text = await readUtf8Body(request, Math.min(MAX_STREAM_HELLO, MAX_PLAYER_FRAME));
    if (!this.host.live()) return new Response(null, { status: 410 });
    if (text === null) return new Response(null, { status: 413 });
    if (isOtherVersion(text)) return this.host.streams.reject(CLOSE.version, 'version', this.host.nextGeneration(), request.signal, () => this.host.live());
    const hello = parseClientFrame(text);
    if (!hello || hello.t !== 'hello' || hello.role !== 'player') return this.host.streams.reject(CLOSE.protocol, 'hello required', this.host.nextGeneration(), request.signal, () => this.host.live());
    return this.host.ctx.blockConcurrencyWhile(() => this.admitStream(request, hello));
  }

  private async hello(socket: WebSocket, prior: Attachment, hello: Extract<ClientFrame, { readonly t: 'hello' }>): Promise<void> {
    const connected = this.host.connectedPlayers();
    const result = await authenticateHello(this.host.ctx.storage, hello, connected, Date.now());
    for (const frame of result.frames) {
      this.host.send(socket, frame);
      if (typeof frame === 'object' && frame !== null && 't' in frame && frame.t === 'gate-paused') {
        const gm = this.host.gmSocket();
        if (gm) this.host.send(gm, frame);
      }
    }
    if (result.close !== undefined) {
      closeSocket(socket, result.close, 'join refused');
      return;
    }
    if (result.admission?.kind === 'gm') {
      const currentFingerprint = this.host.env.HOST_KEY ? await sha256(this.host.env.HOST_KEY) : '';
      if (!currentFingerprint || currentFingerprint !== readMeta(this.host.ctx.storage, 'hostFingerprint')) {
        await this.host.end(CLOSE.noAccess, 'no access');
        return;
      }
    }
    if (!result.admission) { closeSocket(socket, CLOSE.protocol, 'invalid hello'); return; }
    const generation = this.host.nextGeneration();
    if (result.admission.kind === 'gm') {
      writeMeta(this.host.ctx.storage, 'gmGeneration', String(generation));
      socket.serializeAttachment({ ...prior, role: 'gm', generation, tokens: SOCKET_RATE.gmBurst, updatedAt: Date.now() });
      for (const other of this.host.ctx.getWebSockets()) if (other !== socket && attachment(other)?.role === 'gm') closeSocket(other, CLOSE.replaced, 'replaced');
      writeMeta(this.host.ctx.storage, 'gmAwayAt', null);
      await this.host.reschedule();
      this.host.send(socket, { v: 1, t: 'welcome', role: 'gm', players: connected, waiting: waiting(this.host.ctx.storage).filter((record) => !record.admitted).map(({ id, name }) => ({ id, name })), batch: true });
      this.host.broadcast({ v: 1, t: 'gm', online: true }, 'player');
      return;
    }
    if (result.admission.kind === 'waiting') {
      const admission = result.admission;
      const duplicate = this.host.ctx.getWebSockets().some((other) => other !== socket && attachment(other)?.id === admission.id && attachment(other)?.role === 'pending') || this.host.streams.generationOf(admission.id) !== null;
      this.host.streams.replacePlayer(admission.id);
      for (const other of this.host.ctx.getWebSockets()) {
        if (other !== socket && attachment(other)?.id === admission.id && attachment(other)?.role === 'pending') closeSocket(other, CLOSE.replaced, 'replaced');
      }
      this.host.ctx.storage.sql.exec('UPDATE waiting SET active_generation = ? WHERE id = ?', generation, admission.id);
      socket.serializeAttachment({ ...prior, role: 'pending', id: admission.id, name: admission.name, generation, deadline: admission.record.deadline });
      const gm = this.host.gmSocket();
      if (gm && !duplicate) this.host.send(gm, { v: 1, t: 'knock', id: admission.id, name: admission.name });
      await this.host.reschedule();
      return;
    }
    const person = result.admission;
    const keyHash = await sha256(person.key);
    const currentPlayers = this.host.connectedPlayers();
    if (currentPlayers.length >= 12 && !currentPlayers.some((entry) => entry.id === person.id)) { closeSocket(socket, CLOSE.full, 'full'); return; }
    if (!currentPlayers.some((entry) => entry.id === person.id)) this.host.ctx.storage.sql.exec('INSERT INTO players(id,key_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash', person.id, keyHash);
    this.host.ctx.storage.sql.exec('INSERT INTO active_players(id,generation) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation', person.id, generation);
    this.host.streams.replacePlayer(person.id);
    socket.serializeAttachment({ ...prior, role: 'player', id: person.id, name: person.name, generation, tokens: SOCKET_RATE.playerBurst, updatedAt: Date.now() });
    for (const other of this.host.ctx.getWebSockets()) if (other !== socket && attachment(other)?.id === person.id && attachment(other)?.role === 'player') closeSocket(other, CLOSE.replaced, 'replaced');
    if (!this.host.gmSocket() && readMeta(this.host.ctx.storage, 'gmAwayAt') === null) writeMeta(this.host.ctx.storage, 'gmAwayAt', String(Date.now()));
    this.host.send(socket, { v: 1, t: 'welcome', role: 'player', id: person.id, key: person.key, gmOnline: this.host.gmSocket() !== null });
    if (!currentPlayers.some((entry) => entry.id === person.id)) this.host.broadcast({ v: 1, t: 'player-joined', id: person.id, name: person.name }, 'gm');
    await this.host.reschedule();
  }

  private async handlePlayer(socket: WebSocket, frame: ClientFrame, id: string): Promise<void> {
    if (frame.t !== 'send' || frame.to !== undefined) { closeSocket(socket, CLOSE.protocol, 'player cannot send frame'); return; }
    const gm = this.host.gmSocket();
    if (gm) this.host.send(gm, { v: PROTOCOL_VERSION, t: 'game', from: id, body: frame.body });
  }

  private async handleGm(socket: WebSocket, frame: ClientFrame): Promise<void> {
    if (frame.t === 'gate') {
      writeMeta(this.host.ctx.storage, 'gateHash', frame.code === null ? null : await sha256(frame.code));
      writeMeta(this.host.ctx.storage, 'gateConfigured', '1');
      writeMeta(this.host.ctx.storage, 'ask', frame.ask ? '1' : '0');
      this.host.ctx.storage.sql.exec('DELETE FROM gate_failures');
      writeMeta(this.host.ctx.storage, 'gatePausedUntil', null);
      await this.host.reschedule();
      return;
    }
    if (frame.t === 'kick') {
      const wasConnected = this.host.connectedPlayers().some((player) => player.id === frame.id);
      this.host.ctx.storage.sql.exec('DELETE FROM players WHERE id = ?', frame.id);
      this.host.ctx.storage.sql.exec('DELETE FROM waiting WHERE id = ?', frame.id);
      this.host.ctx.storage.sql.exec('DELETE FROM active_players WHERE id = ?', frame.id);
      this.host.streams.closePlayer(frame.id, CLOSE.kicked, 'kicked');
      for (const other of this.host.ctx.getWebSockets()) if (attachment(other)?.id === frame.id) closeSocket(other, CLOSE.kicked, 'kicked');
      if (wasConnected) this.host.broadcast({ v: 1, t: 'player-left', id: frame.id }, 'gm');
      await this.host.reschedule();
      return;
    }
    if (frame.t === 'send' || frame.t === 'sends') {
      const sends = frame.t === 'send' ? [{ to: frame.to ?? '*', body: frame.body }] : frame.sends;
      for (const entry of sends) {
        const recipient = { v: 1, t: 'game', body: entry.body };
        for (const playerSocket of this.host.ctx.getWebSockets()) {
          const state = attachment(playerSocket);
          if (state?.role === 'player' && this.host.generationCurrent(state) && (entry.to === '*' || state.id === entry.to)) this.host.send(playerSocket, recipient);
        }
        this.host.streams.publish(entry.to, recipient);
      }
      return;
    }
    if (frame.t === 'admit' || frame.t === 'decline') await this.answerKnock(socket, frame.id, frame.t === 'admit');
    else if (frame.t === 'end') await this.host.end(CLOSE.ended, 'ended');
    else closeSocket(socket, CLOSE.protocol, 'gm cannot send frame');
  }

  private async answerKnock(gm: WebSocket, id: string, admit: boolean): Promise<void> {
    const record = waiting(this.host.ctx.storage).find((item) => item.id === id);
    if (!record || record.admitted) return;
    if (!admit) {
      this.host.ctx.storage.sql.exec('DELETE FROM waiting WHERE id = ?', id);
      for (const socket of this.host.ctx.getWebSockets()) {
        if (attachment(socket)?.id === id && attachment(socket)?.role === 'pending') closeSocket(socket, CLOSE.declined, 'declined');
      }
      this.host.streams.closePlayer(id, CLOSE.declined, 'declined');
      this.host.send(gm, { v: 1, t: 'knock-gone', id });
      await this.host.reschedule();
      return;
    }
    const key = secret();
    const keyHash = await sha256(key);
    const current = waiting(this.host.ctx.storage).find((item) => item.id === id);
    if (!current || current.admitted !== 0 || Date.now() >= current.deadline) return;
    const connected = this.host.connectedPlayers();
    if (connected.length >= 12 && !connected.some((person) => person.id === id)) {
      this.host.ctx.storage.sql.exec('DELETE FROM waiting WHERE id = ?', id);
      for (const playerSocket of this.host.ctx.getWebSockets()) {
        if (attachment(playerSocket)?.id === id && attachment(playerSocket)?.role === 'pending') closeSocket(playerSocket, CLOSE.full, 'full');
      }
      this.host.streams.closePlayer(id, CLOSE.full, 'full');
      this.host.send(gm, { v: 1, t: 'knock-gone', id, full: true });
      await this.host.reschedule();
      return;
    }
    this.host.ctx.storage.sql.exec('INSERT INTO players(id,key_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash', id, keyHash);
    this.host.ctx.storage.sql.exec('UPDATE waiting SET admitted = 1, key_hash = ? WHERE id = ?', keyHash, id);
    const generation = current.activeGeneration;
    const liveSocket = generation !== null && this.host.ctx.getWebSockets().some((socket) => {
      const state = attachment(socket);
      return socket.readyState === WebSocket.OPEN && state?.id === id && state.role === 'pending' && state.generation === generation;
    });
    const liveStream = generation !== null && this.host.streams.generationOf(id) === generation;
    if (generation !== null && (liveSocket || liveStream)) {
      this.host.ctx.storage.sql.exec('INSERT INTO active_players(id,generation) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation', id, generation);
      for (const playerSocket of this.host.ctx.getWebSockets()) {
        const state = attachment(playerSocket);
        if (state?.id !== id || state.role !== 'pending') continue;
        if (state.generation !== generation) { closeSocket(playerSocket, CLOSE.replaced, 'replaced'); continue; }
        playerSocket.serializeAttachment({ ...state, role: 'player', tokens: SOCKET_RATE.playerBurst, updatedAt: Date.now() });
        this.host.send(playerSocket, { v: 1, t: 'welcome', role: 'player', id, key, gmOnline: true });
      }
      if (this.host.streams.generationOf(id) === generation) {
        this.host.streams.admitPlayer(id, generation);
        this.host.streams.publish(id, { v: 1, t: 'welcome', role: 'player', id, key, gmOnline: true });
      }
      this.host.broadcast({ v: 1, t: 'player-joined', id, name: record.name }, 'gm');
    } else {
      this.host.ctx.storage.sql.exec('DELETE FROM active_players WHERE id = ?', id);
      this.host.ctx.storage.sql.exec('UPDATE waiting SET active_generation = NULL WHERE id = ?', id);
    }
    this.host.send(gm, { v: 1, t: 'knock-gone', id });
    await this.host.reschedule();
  }

  private async admitStream(request: Request, hello: PlayerHello): Promise<Response> {
    if (!this.host.live()) return new Response(null, { status: 410 });
    const connected = this.host.connectedPlayers();
    const result = await authenticateHello(this.host.ctx.storage, hello, connected, Date.now());
    if (result.close !== undefined) {
      for (const frame of result.frames) {
        if (typeof frame === 'object' && frame !== null && 't' in frame && frame.t === 'gate-paused') {
          const gm = this.host.gmSocket();
          if (gm) this.host.send(gm, frame);
        }
      }
      return this.host.streams.reject(result.close, 'join refused', this.host.nextGeneration(), request.signal, () => this.host.live());
    }
    if (!result.admission || result.admission.kind === 'gm') return this.host.streams.reject(CLOSE.protocol, 'invalid hello', this.host.nextGeneration(), request.signal, () => this.host.live());
    if (result.admission.kind === 'waiting') {
      const admission = result.admission;
      const generation = this.host.nextGeneration();
      const duplicate = this.host.ctx.getWebSockets().some((socket) => attachment(socket)?.id === admission.id && attachment(socket)?.role === 'pending') || this.host.streams.generationOf(admission.id) !== null;
      this.host.streams.replacePlayer(admission.id);
      for (const socket of this.host.ctx.getWebSockets()) {
        if (attachment(socket)?.id === admission.id && attachment(socket)?.role === 'pending') closeSocket(socket, CLOSE.replaced, 'replaced');
      }
      this.host.ctx.storage.sql.exec('UPDATE waiting SET active_generation = ? WHERE id = ?', generation, admission.id);
      const gm = this.host.gmSocket();
      if (gm && !duplicate) this.host.send(gm, { v: 1, t: 'knock', id: admission.id, name: admission.name });
      const response = await this.host.streams.open(admission.id, admission.name, generation, false, async (frame: PlayerSend) => {
        if (!this.host.playerGenerationIsCurrent(admission.id, generation)) return;
        const currentGm = this.host.gmSocket();
        if (currentGm) this.host.send(currentGm, { v: PROTOCOL_VERSION, t: 'game', from: admission.id, body: frame.body });
      }, result.frames, request.signal, (id, closedGeneration) => this.host.clearStreamGeneration(id, closedGeneration), () => this.host.waitingGenerationIsCurrent(admission.id, generation) || this.host.playerGenerationIsCurrent(admission.id, generation));
      await this.host.reschedule();
      return response;
    }
    const admission = result.admission;
    const generation = this.host.nextGeneration();
    const keyHash = await sha256(admission.key);
    const currentPlayers = this.host.connectedPlayers();
    if (currentPlayers.length >= 12 && !currentPlayers.some((person) => person.id === admission.id)) {
      return this.host.streams.reject(CLOSE.full, 'full', this.host.nextGeneration(), request.signal, () => this.host.live());
    }
    if (!currentPlayers.some((person) => person.id === admission.id)) this.host.ctx.storage.sql.exec('INSERT INTO players(id,key_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash', admission.id, keyHash);
    this.host.ctx.storage.sql.exec('INSERT INTO active_players(id,generation) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation', admission.id, generation);
    this.host.streams.replacePlayer(admission.id);
    for (const socket of this.host.ctx.getWebSockets()) {
      if (attachment(socket)?.id === admission.id && attachment(socket)?.role === 'player') closeSocket(socket, CLOSE.replaced, 'replaced');
    }
    if (!this.host.gmSocket() && readMeta(this.host.ctx.storage, 'gmAwayAt') === null) writeMeta(this.host.ctx.storage, 'gmAwayAt', String(Date.now()));
    const welcome = { v: 1, t: 'welcome', role: 'player', id: admission.id, key: admission.key, gmOnline: this.host.gmSocket() !== null };
    if (!connected.some((person) => person.id === admission.id)) this.host.broadcast({ v: 1, t: 'player-joined', id: admission.id, name: admission.name }, 'gm');
    const response = await this.host.streams.open(admission.id, admission.name, generation, true, async (frame: PlayerSend) => {
      if (!this.host.playerGenerationIsCurrent(admission.id, generation)) return;
      const gm = this.host.gmSocket();
      if (gm) this.host.send(gm, { v: PROTOCOL_VERSION, t: 'game', from: admission.id, body: frame.body });
    }, [welcome], request.signal, (id, closedGeneration) => this.host.clearStreamGeneration(id, closedGeneration), () => this.host.playerGenerationIsCurrent(admission.id, generation));
    await this.host.reschedule();
    return response;
  }
}