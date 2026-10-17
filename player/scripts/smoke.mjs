import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const HOST_KEY = 'atlas-vtt-local-test-host-key';
export async function startRelay(port = 8787) {
  const storage = await mkdtemp(resolve(tmpdir(), 'atlas-conformance-'));
  const child = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', 'relay/wrangler.jsonc', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', storage, '--var', `HOST_KEY:${HOST_KEY}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  let closed = false;
  const signalChild = (signal) => {
    if (child.pid !== undefined && child.exitCode === null) child.kill(signal);
  };
  process.once('exit', () => {
    signalChild('SIGTERM');
    rmSync(storage, { recursive: true, force: true });
  });
  const stop = async () => {
    if (closed) return;
    closed = true;
    if (child.pid !== undefined && child.exitCode === null) {
      const exited = once(child, 'exit');
      signalChild('SIGTERM');
      const timeout = setTimeout(() => signalChild('SIGKILL'), 5000);
      await exited;
      clearTimeout(timeout);
    }
    await rm(storage, { recursive: true, force: true });
  };
  try {
    const deadline = Date.now() + 60000;
    while (true) {
      if (child.exitCode !== null) throw new Error(`Relay exited: ${logs}`);
      try {
        const response = await fetch(`${origin}/api/me`, { headers: { Authorization: `Bearer ${HOST_KEY}` } });
        if (response.ok) break;
      } catch {}
      if (Date.now() >= deadline) throw new Error(`Relay readiness timed out: ${logs}`);
      await new Promise((done) => setTimeout(done, 100));
    }
    return { origin, stop, logs: () => logs };
  } catch (error) { await stop(); throw error; }
}

export async function startSmoke({ relayPort = 8787, port = 8790 } = {}) {
  const relay = await startRelay(relayPort);
  let vite;
  let fixture;
  let dom;
  const streams = new Set();
  const originals = new Map();
  const restoreGlobals = () => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
  try {
    const virtualConsole = new VirtualConsole();
    virtualConsole.sendTo(console, { omitJSDOMErrors: true });
    virtualConsole.on('jsdomError', (error) => { if (error.type !== 'not implemented') console.error(error); });
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: relay.origin, pretendToBeVisual: true, virtualConsole });
    for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLImageElement', 'HTMLCanvasElement', 'SVGElement', 'Element', 'Node', 'Document', 'Image', 'DOMRect', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'DOMParser', 'localStorage', 'getComputedStyle']) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] });
    }
    for (const name of ['requestAnimationFrame', 'cancelAnimationFrame']) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
    globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
    vite = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': { target: relay.origin, ws: true } } }, resolve: { alias: { obsidian: resolve(root, 'player/tests/obsidianHost.ts'), src: resolve(root, 'src'), '@': resolve(root, 'src') } }, plugins: [{ name: 'atlas-local-smoke', transformIndexHtml: { order: 'pre', handler(html, context) { return context.path === '/player/index.html' ? html.replace('src="/src/main.tsx"', 'src="/player/src/main.tsx"') : html; } }, configureServer(server) {
      server.middlewares.use('/__smoke', async (request, response) => {
        try {
          if (!fixture) { response.writeHead(503).end(); return; }
          if (request.method === 'GET' && request.url === '/table') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(fixture.connection)); return; }
          if (request.method === 'GET' && request.url === '/state') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            const send = () => response.write(`data: ${JSON.stringify(fixture.snapshot())}\n\n`);
            streams.add(response); send();
            const unsubscribe = fixture.subscribe(send);
            response.on('close', () => { streams.delete(response); unsubscribe(); });
            return;
          }
          if (request.method === 'POST' && request.url === '/command') {
            let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 65536) throw new Error('Command too large'); }
            const result = await fixture.command(JSON.parse(body));
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result ?? null)); return;
          }
          response.writeHead(404).end();
        } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(error) })); }
      });
    } }], optimizeDeps: { include: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      '@radix-ui/react-dropdown-menu', '@radix-ui/react-tooltip', '@radix-ui/react-slot',
      'lucide-react', 'zustand', 'zustand/vanilla', 'zustand/vanilla/shallow',
      'pixi.js', 'pixi-viewport', 'markdown-it', 'framer-motion', 'clsx', 'tailwind-merge',
      'three', 'three/examples/jsm/environments/RoomEnvironment.js', 'clipper2-ts',
    ] }, });
    await vite.listen();
    await vite.ssrLoadModule('/tests/setup/obsidianDom.ts');
    await vite.ssrLoadModule('/tests/setup/domHost.ts');
    const module = await vite.ssrLoadModule('/player/tests/smokeTable.ts');
    const created = await fetch(`${relay.origin}/api/tables`, { method: 'POST', headers: { Authorization: `Bearer ${HOST_KEY}` } });
    if (created.status !== 201) throw new Error(`Table creation failed: ${created.status}`);
    fixture = await module.createSmokeTable({ origin: relay.origin, table: await created.json() });
    let stopped = false;
    return { relay, fixture, url: `http://127.0.0.1:${port}/player/tests/gm.html`, async stop() { if (stopped) return; stopped = true; for (const stream of streams) stream.end(); fixture.stop(); await vite.close(); dom.window.close(); restoreGlobals(); await relay.stop(); } };
  } catch (error) { fixture?.stop(); await vite?.close(); dom?.window.close(); restoreGlobals(); await relay.stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const smoke = await startSmoke();
  console.log(JSON.stringify({ gm: smoke.url, player: `http://127.0.0.1:8790/player/index.html#${smoke.fixture.connection.table}`, code: smoke.fixture.connection.code }));
  let stopping = false;
  const stop = async (code = 0) => {
    if (code !== 0) process.exitCode = code;
    if (stopping) return;
    stopping = true;
    try { await smoke.stop(); } catch (error) { console.error(error); process.exitCode = 1; }
    process.exit(process.exitCode ?? 0);
  };
  const fail = (error) => { console.error(error); void stop(1); };
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (text) => { try { console.log(JSON.stringify(await smoke.fixture.command(JSON.parse(text)))); } catch (error) { console.error(error); } });
}
