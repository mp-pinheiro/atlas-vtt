import { startSmoke } from './smoke.mjs';

if (!process.send) throw new Error('The acceptance fixture requires a Node IPC parent');
const smoke = await startSmoke({ relayPort: Number(process.argv[2]), port: Number(process.argv[3]) });
let stopping = false;
const unsubscribe = smoke.fixture.subscribe(() => {
  if (process.connected) process.send({ t: 'snapshot', snapshot: smoke.fixture.snapshot() });
});
process.on('message', async (message) => {
  if (message.t !== 'command' || stopping) return;
  try {
    const result = await smoke.fixture.command(message.command);
    if (process.connected) process.send({ t: 'result', id: message.id, result, snapshot: smoke.fixture.snapshot() });
  } catch (error) {
    if (process.connected) process.send({ t: 'error', id: message.id, message: String(error) });
  }
});
process.on('disconnect', async () => {
  stopping = true;
  unsubscribe();
  try { await smoke.stop(); }
  finally { process.exit(0); }
});
process.send({ t: 'ready', url: smoke.url, connection: smoke.fixture.connection, snapshot: smoke.fixture.snapshot() });
