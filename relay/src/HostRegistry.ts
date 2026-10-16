import { DurableObject } from 'cloudflare:workers';
import { CLOSE, MAX_PLAYERS } from '../../src/app/online/protocol/relay.ts';
import type { Env } from './index.ts';
import { equalDigest, secret, sha256, tableCode } from './credentials.ts';
import { readMeta, writeMeta } from './tableState.ts';

interface PendingCreate {
  readonly idName: string;
  readonly secretHash: string;
  readonly hostFingerprint: string;
  readonly oldIdName: string | null;
  readonly createdAt: number;
}

export class HostRegistry extends DurableObject<Env> {
  private serial: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/create' || request.method !== 'POST') return new Response(null, { status: 404 });
    const hostKey = this.env.HOST_KEY;
    if (!hostKey) return Response.json({ reason: 'not-configured' }, { status: 503 });
    const authorization = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    const fingerprint = await sha256(hostKey);
    if (!authorization || !equalDigest(await sha256(authorization), fingerprint)) return Response.json({ reason: 'unauthorized' }, { status: 401 });
    const result = this.serial.then(() => this.create(fingerprint));
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }

  private async create(hostFingerprint: string): Promise<Response> {
    if (!await this.resumePending(hostFingerprint)) return new Response(null, { status: 503 });
    const code = tableCode();
    const idName = await sha256(code);
    const tableSecret = secret();
    const operation: PendingCreate = { idName, secretHash: await sha256(tableSecret), hostFingerprint, oldIdName: readMeta(this.ctx.storage, 'active'), createdAt: Date.now() };
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    writeMeta(this.ctx.storage, 'pending', JSON.stringify(operation));
    if (!(await this.initialize(operation)).ok) {
      writeMeta(this.ctx.storage, 'pending', null);
      await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 503 });
    }
    await this.finish(operation);
    writeMeta(this.ctx.storage, 'pending', null);
    await this.ctx.storage.deleteAlarm();
    return Response.json({ code, secret: tableSecret, maxPlayers: MAX_PLAYERS }, { status: 201 });
  }

  async alarm(): Promise<void> {
    const operation = this.serial.then(() => this.recover());
    this.serial = operation.then(() => undefined, () => undefined);
    await operation;
  }

  private async recover(): Promise<void> {
    const fingerprint = this.env.HOST_KEY ? await sha256(this.env.HOST_KEY) : null;
    if (!await this.resumePending(fingerprint)) throw new Error('Table initialization failed');
  }

  private async resumePending(fingerprint: string | null): Promise<boolean> {
    const raw = readMeta(this.ctx.storage, 'pending');
    if (!raw) return true;
    const operation = JSON.parse(raw) as PendingCreate;
    if (operation.hostFingerprint !== fingerprint) {
      await this.abandon(operation, CLOSE.noAccess);
      return true;
    }
    const response = await this.initialize(operation);
    if (response.status === 409) {
      await this.abandon(operation, CLOSE.ended);
      return true;
    }
    if (!response.ok) return false;
    await this.finish(operation);
    writeMeta(this.ctx.storage, 'pending', null);
    await this.ctx.storage.deleteAlarm();
    return true;
  }

  private async abandon(operation: PendingCreate, code: number): Promise<void> {
    const table = this.env.TABLES.get(this.env.TABLES.idFromName(operation.idName));
    const response = await table.fetch(new Request('https://table/end', { method: 'POST', headers: { 'x-close-code': String(code) } }));
    if (!response.ok) throw new Error('Revoked table could not be ended');
    if (readMeta(this.ctx.storage, 'active') === operation.idName) writeMeta(this.ctx.storage, 'active', null);
    writeMeta(this.ctx.storage, 'pending', null);
    await this.ctx.storage.deleteAlarm();
  }

  private async initialize(operation: PendingCreate): Promise<Response> {
    const table = this.env.TABLES.get(this.env.TABLES.idFromName(operation.idName));
    return table.fetch(new Request('https://table/initialize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codeHash: operation.idName, secretHash: operation.secretHash, hostFingerprint: operation.hostFingerprint, createdAt: operation.createdAt }) }));
  }

  private async finish(operation: PendingCreate): Promise<void> {
    if (operation.oldIdName) {
      const oldTable = this.env.TABLES.get(this.env.TABLES.idFromName(operation.oldIdName));
      const response = await oldTable.fetch(new Request('https://table/end', { method: 'POST', headers: { 'x-close-code': String(CLOSE.superseded) } }));
      if (!response.ok) throw new Error('Previous table could not be ended');
    }
    writeMeta(this.ctx.storage, 'hostFingerprint', operation.hostFingerprint);
    writeMeta(this.ctx.storage, 'active', operation.idName);
  }
}
