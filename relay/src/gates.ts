import { CLOSE, JOIN_CODE_PATTERN, MAX_PLAYERS, MAX_WAITING, SECRET_PATTERN, type Hello, type PlayerInfo } from '../../src/app/online/protocol/relay.ts';
import { equalDigest, playerId, secret, sha256 } from './credentials.ts';
import { readMeta, waiting, writeMeta, type WaitingRecord } from './tableState.ts';

export type Admission =
  | { readonly kind: 'gm'; readonly secretHash: string }
  | { readonly kind: 'player'; readonly id: string; readonly name: string; readonly key: string }
  | { readonly kind: 'waiting'; readonly id: string; readonly name: string; readonly token: string; readonly record: WaitingRecord };

export interface AdmissionResult {
  readonly admission?: Admission;
  readonly frames: readonly unknown[];
  readonly close?: number;
}

export async function authenticateHello(storage: DurableObjectStorage, hello: Hello, connected: readonly PlayerInfo[], now: number): Promise<AdmissionResult> {
  if (hello.role === 'gm') {
    const supplied = typeof hello.secret === 'string' ? hello.secret : '';
    const hashed = await sha256(supplied);
    const stored = readMeta(storage, 'secretHash');
    if (stored === null || !equalDigest(hashed, stored)) return { frames: [], close: CLOSE.badSecret };
    return { admission: { kind: 'gm', secretHash: hashed }, frames: [] };
  }
  if (hello.role !== 'player' || typeof hello.name !== 'string') return { frames: [], close: CLOSE.protocol };
  if (typeof hello.key === 'string') {
    if (!SECRET_PATTERN.test(hello.key)) return { frames: [], close: CLOSE.badSecret };
    const keyHash = await sha256(hello.key);
    const row = storage.sql.exec<{ id: string }>('SELECT id FROM players WHERE key_hash = ?', keyHash).toArray()[0];
    if (!row) return { frames: [], close: CLOSE.badSecret };
    if (connected.length >= MAX_PLAYERS && !connected.some((person) => person.id === row.id)) return { frames: [], close: CLOSE.full };
    storage.sql.exec('DELETE FROM waiting WHERE id = ?', row.id);
    return { admission: { kind: 'player', id: row.id, name: hello.name, key: hello.key }, frames: [] };
  }
  if (typeof hello.wait === 'string') {
    if (!SECRET_PATTERN.test(hello.wait)) return { frames: [], close: CLOSE.noAnswer };
    const waitHash = await sha256(hello.wait);
    const record = waiting(storage).find((item) => item.waitHash === waitHash);
    if (!record || now >= record.deadline) return { frames: [], close: CLOSE.noAnswer };
    if (record.admitted) {
      if (connected.length >= MAX_PLAYERS && !connected.some((person) => person.id === record.id)) return { frames: [{ v: 1, t: 'knock-gone', id: record.id, full: true }], close: CLOSE.full };
      const key = secret();
      const keyHash = await sha256(key);
      storage.sql.exec('INSERT INTO players(id,key_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash', record.id, keyHash);
      storage.sql.exec('UPDATE waiting SET key_hash = ? WHERE id = ?', keyHash, record.id);
      return { admission: { kind: 'player', id: record.id, name: record.name, key }, frames: [] };
    }
    return { admission: { kind: 'waiting', id: record.id, name: record.name, token: hello.wait, record }, frames: [{ v: 1, t: 'waiting' }] };
  }
  const pausedUntil = Number(readMeta(storage, 'gatePausedUntil') ?? 0);
  if (now < pausedUntil) return { frames: [{ v: 1, t: 'gate-paused', until: pausedUntil }], close: CLOSE.paused };
  if (readMeta(storage, 'gateConfigured') !== '1') {
    storage.sql.exec('DELETE FROM gate_failures WHERE at <= ?', now - 60_000);
    storage.sql.exec('INSERT INTO gate_failures (at) VALUES (?)', now);
    const failures = storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM gate_failures').toArray()[0]?.n ?? 0;
    if (failures >= 5) {
      const until = now + 60_000;
      writeMeta(storage, 'gatePausedUntil', String(until));
      return { frames: [{ v: 1, t: 'gate-paused', until }], close: CLOSE.paused };
    }
    return { frames: [], close: CLOSE.wrongCode };
  }
  const gateHash = readMeta(storage, 'gateHash');
  const code = typeof hello.code === 'string' ? hello.code : undefined;
  if (gateHash !== null && (!code || !JOIN_CODE_PATTERN.test(code) || await sha256(code) !== gateHash)) {
    storage.sql.exec('DELETE FROM gate_failures WHERE at <= ?', now - 60_000);
    storage.sql.exec('INSERT INTO gate_failures (at) VALUES (?)', now);
    const failures = storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM gate_failures').toArray()[0]?.n ?? 0;
    if (failures >= 5) {
      const until = now + 60_000;
      writeMeta(storage, 'gatePausedUntil', String(until));
      return { frames: [{ v: 1, t: 'gate-paused', until }], close: CLOSE.paused };
    }
    return { frames: [], close: CLOSE.wrongCode };
  }
  const id = playerId();
  if (readMeta(storage, 'ask') !== '0') {
    if (waiting(storage).filter((record) => record.admitted === 0).length >= MAX_WAITING) return { frames: [], close: CLOSE.tooManyKnocks };
    const token = secret();
    const record: WaitingRecord = { id, name: hello.name, waitHash: await sha256(token), deadline: now + 5 * 60_000, admitted: 0, keyHash: null, activeGeneration: null };
    storage.sql.exec('INSERT INTO waiting (id,name,wait_hash,deadline) VALUES (?,?,?,?)', record.id, record.name, record.waitHash, record.deadline);
    return { admission: { kind: 'waiting', id, name: record.name, token, record }, frames: [{ v: 1, t: 'waiting', wait: token }] };
  }
  return { admission: { kind: 'player', id, name: hello.name, key: secret() }, frames: [] };
}
