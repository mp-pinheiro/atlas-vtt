import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { SmokeSnapshot, SmokeTable } from './smokeTable.ts';

type Fixture = Pick<SmokeTable, 'connection' | 'snapshot' | 'command'>;
export interface AcceptanceHost {
  readonly url: string;
  readonly fixture: Fixture;
  stop(): Promise<void>;
}
type HostMessage =
  | { readonly t: 'ready'; readonly url: string; readonly connection: Fixture['connection']; readonly snapshot: SmokeSnapshot }
  | { readonly t: 'snapshot'; readonly snapshot: SmokeSnapshot }
  | { readonly t: 'result'; readonly id: number; readonly result: unknown; readonly snapshot: SmokeSnapshot }
  | { readonly t: 'error'; readonly id: number; readonly message: string };

export async function startAcceptanceHost(relayPort: number, port: number): Promise<AcceptanceHost> {
  const child = fork(fileURLToPath(new URL('../scripts/acceptance.mjs', import.meta.url)), [String(relayPort), String(port)], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    detached: true,
  });
  let logs = '';
  child.stdout?.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  let latest: SmokeSnapshot | undefined;
  let failure: Error | null = null;
  let stopped = false;
  let serial = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const ready = Promise.withResolvers<Extract<HostMessage, { t: 'ready' }>>();
  const fail = (error: Error): void => {
    failure = error;
    ready.reject(error);
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  };
  child.on('message', (raw) => {
    const message = raw as HostMessage;
    if (message.t === 'ready') { latest = message.snapshot; ready.resolve(message); }
    else if (message.t === 'snapshot') latest = message.snapshot;
    else if (message.t === 'result' || message.t === 'error') {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.t === 'result') { latest = message.snapshot; waiting?.resolve(message.result); }
      else waiting?.reject(new Error(message.message));
    }
  });
  child.on('error', fail);
  child.on('exit', (code, signal) => { if (!stopped) fail(new Error(`Acceptance fixture exited (${signal ?? code}): ${logs}`)); });
  const kill = (): void => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    for (const waiting of pending.values()) waiting.reject(new Error('Acceptance fixture stopped'));
    pending.clear();
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    const timeout = setTimeout(kill, 10000);
    if (child.connected) child.disconnect();
    else kill();
    try { await exited; }
    finally { clearTimeout(timeout); }
  };
  const deadline = setTimeout(() => fail(new Error(`Acceptance fixture did not become ready: ${logs}`)), 60000);
  try {
    const started = await ready.promise;
    clearTimeout(deadline);
    return {
      url: started.url,
      fixture: {
        connection: started.connection,
        snapshot(): SmokeSnapshot {
          if (failure !== null) throw failure;
          if (latest === undefined) throw new Error('Acceptance fixture has no snapshot');
          return latest;
        },
        command(command): Promise<unknown> {
          if (failure !== null || stopped) return Promise.reject(failure ?? new Error('Acceptance fixture stopped'));
          const id = ++serial;
          const waiting = Promise.withResolvers<unknown>();
          pending.set(id, waiting);
          child.send({ t: 'command', id, command }, (error) => {
            if (error) { pending.delete(id); waiting.reject(error); }
          });
          return waiting.promise;
        },
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}
