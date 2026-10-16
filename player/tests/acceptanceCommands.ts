import type { BrowserCommand } from 'vitest/node';
import type {} from '@vitest/browser-playwright';
import type { BrowserContext, Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSmoke } from '../scripts/smoke.mjs';
import { expect } from 'playwright/test';
import type { SmokeTable } from './smokeTable.ts';
import { parseGmMessage } from '../../src/app/online/protocol';

interface AcceptanceResult { readonly scenarios: readonly string[]; readonly screenshots: readonly string[] }
interface SmokeProcess {
  readonly url: string;
  readonly fixture: SmokeTable;
  stop(): Promise<void>;
}
interface CancelObservation { seen: boolean; readonly observer: MutationObserver }
interface CancellationWindow extends Window { __atlasCancelObservation?: CancelObservation }

async function worldPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('.atlas-player__canvas canvas').boundingBox();
  if (!box) throw new Error('The actual player canvas is not visible');
  const scale = Math.min(box.width, box.height) / 1400;
  return { x: box.x + (box.width - 1400 * scale) / 2 + x * scale, y: box.y + (box.height - 1400 * scale) / 2 + y * scale };
}

interface BrowserCache { readonly rows: readonly { readonly key: string; readonly player: string; readonly geometry: string; readonly size: number }[]; readonly assets: number }
async function browserCache(page: Page): Promise<BrowserCache> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('atlas-player', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const rows = await new Promise<{ key: string; player: string; geometry: string; png: Blob }[]>((resolve, reject) => { const request = db.transaction('explored').objectStore('explored').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const assets = await new Promise<number>((resolve, reject) => { const request = db.transaction('assets').objectStore('assets').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return { rows: rows.map((row) => ({ key: row.key, player: row.player, geometry: row.geometry, size: row.png.size })), assets };
    } finally { db.close(); }
  });
}

async function pictureLuminance(page: Page): Promise<{ left: number; right: number; leftToken: number; rightToken: number }> {
  const canvas = page.locator('.atlas-player__canvas canvas');
  const box = await canvas.boundingBox(); if (!box) throw new Error('Player canvas unavailable');
  const screenshot = await canvas.screenshot();
  return page.evaluate(async ({ bytes, width, height }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    try {
      const target = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = target.getContext('2d'); if (!context) throw new Error('Screenshot decoder unavailable');
      context.drawImage(bitmap, 0, 0);
      const scale = Math.min(width, height) / 1400;
      const luminance = (worldX: number, worldY: number): number => {
        const x = Math.floor(((width - 1400 * scale) / 2 + worldX * scale) * bitmap.width / width);
        const y = Math.floor(((height - 1400 * scale) / 2 + worldY * scale) * bitmap.height / height);
        const pixel = context.getImageData(x, y, 1, 1).data;
        return (pixel[0]! + pixel[1]! + pixel[2]!) / 3;
      };
      return { left: luminance(410, 410), right: luminance(1000, 500), leftToken: luminance(315, 315), rightToken: luminance(1085, 315) };
    } finally { bitmap.close(); }
  }, { bytes: Array.from(screenshot), width: box.width, height: box.height });
}

export const atlasAcceptance: BrowserCommand<[], AcceptanceResult> = async ({ context }) => {
  const browser = context.browser();
  if (!browser) throw new Error('Acceptance requires the configured Playwright browser provider');
  const smoke: SmokeProcess = await startSmoke();
  const contexts: BrowserContext[] = [];
  const scenarios: string[] = [];
  const screenshots: string[] = [];
  try {
    const makePage = async (): Promise<Page> => { const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(isolated); return isolated.newPage(); };
    const gm = await makePage();
    await gm.goto(smoke.url);
    await expect(gm.locator('#status')).toHaveText('online', { timeout: 30000 });
    await gm.locator('[data-permission="perPlayerVision"]').check();
    const alice = await makePage(); const bob = await makePage();
    const received = new Map<Page, string[]>();
    for (const page of [alice, bob]) {
      received.set(page, []);
      const parts = new Map<string, string[]>();
      page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
        const text = typeof payload === 'string' ? payload : payload.toString('utf8');
        if (text === 'pong') return;
        const envelope = JSON.parse(text);
        if (envelope.t !== 'game') return;
        const body = envelope.body;
        if (body.t !== 'part') { received.get(page)!.push(JSON.stringify(body)); return; }
        const held = parts.get(body.id) ?? [];
        held[body.index] = body.data; parts.set(body.id, held);
        if (held.filter(Boolean).length === body.count) { received.get(page)!.push(Buffer.concat(held.map((part) => Buffer.from(part, 'base64'))).toString('utf8')); parts.delete(body.id); }
      }));
    }
    for (const [page, name] of [[alice, 'Alice'], [bob, 'Bob']] as const) {
      await page.goto(`http://127.0.0.1:8790/player/index.html#${smoke.fixture.connection.table}`);
      await page.getByLabel('Your name', { exact: true }).fill(name);
      await page.getByLabel('Join code', { exact: true }).fill(smoke.fixture.connection.code);
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect.poll(() => smoke.fixture.snapshot().gate.waiting.some((person) => person.name === name && person.armed)).toBe(true);
      await gm.getByRole('button', { name: `Admit ${name}`, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Leave and forget', exact: true })).toBeVisible();
      await gm.getByRole('button', { name: `Give ${name.toLowerCase()} to ${name}`, exact: true }).click();
    }
    scenarios.push('Two real browser identities admitted by the real OnlineTable gate');
    for (const page of [alice, bob]) await expect(page.locator('.atlas-player__canvas canvas')).toBeVisible();
    await expect.poll(() => received.get(alice)!.some((body) => body.includes('"personal":true'))).toBe(true);
    await expect.poll(() => received.get(bob)!.some((body) => body.includes('"personal":true'))).toBe(true);
    await expect.poll(() => received.get(alice)!.some((body) => body.includes('"whole":true'))).toBe(true);
    expect(received.get(alice)!.join('\n')).not.toContain('Right-room goblin');
    expect(received.get(bob)!.join('\n')).not.toContain('Left-room goblin');
    scenarios.push('Serialized recipient pictures exclude the other room NPC identity');
    await expect.poll(async () => (await pictureLuminance(alice)).left).toBeGreaterThan(40);
    await expect.poll(async () => (await pictureLuminance(bob)).right).toBeGreaterThan(40);
    expect((await pictureLuminance(alice)).right).toBeLessThan(5);
    expect((await pictureLuminance(bob)).left).toBeLessThan(5);
    scenarios.push('Actual browser pixels show each room only to its owning source');
    await smoke.fixture.command({ type: 'fog', value: true });
    await expect.poll(async () => (await pictureLuminance(alice)).left).toBeLessThan(5);
    await expect.poll(async () => (await pictureLuminance(bob)).right).toBeLessThan(5);
    expect((await pictureLuminance(alice)).leftToken).toBeLessThan(5);
    expect((await pictureLuminance(bob)).rightToken).toBeLessThan(5);
    await smoke.fixture.command({ type: 'fog', value: false });
    await expect.poll(async () => (await pictureLuminance(alice)).left).toBeGreaterThan(40);
    await expect.poll(async () => (await pictureLuminance(bob)).right).toBeGreaterThan(40);
    scenarios.push('Committed fog covers actual floor and token art without removing vision sources');
    await smoke.fixture.command({ type: 'explored-memory', value: false });
    await smoke.fixture.command({ type: 'token-vision', id: 'alice', value: false });
    await expect.poll(async () => (await pictureLuminance(alice)).left).toBeLessThan(5);
    await smoke.fixture.command({ type: 'scene-token-vision', value: false });
    await expect.poll(async () => (await pictureLuminance(alice)).right).toBeGreaterThan(40);
    await smoke.fixture.command({ type: 'scene-token-vision', value: true });
    await expect.poll(async () => (await pictureLuminance(alice)).left).toBeLessThan(5);
    await smoke.fixture.command({ type: 'token-vision', id: 'alice', value: true });
    await smoke.fixture.command({ type: 'explored-memory', value: true });
    await expect.poll(async () => (await pictureLuminance(alice)).left).toBeGreaterThan(40);
    scenarios.push('No owned source reveals no live floor, while explicit scene tokenVision off remains all-lit');
    const torch = alice.locator('.atlas-player__widget').filter({ hasText: 'Torch' }).locator('strong');
    await expect(torch).toBeVisible();
    const initialTorch = await torch.textContent();
    const aliceId = Object.entries(smoke.fixture.snapshot().ownership.players).find(([, person]) => person.name === 'Alice')?.[0];
    if (!aliceId) throw new Error('Alice was not admitted');
    const start = await worldPoint(alice, 315, 315); const destination = await worldPoint(alice, 385, 315);
    await alice.mouse.move(start.x, start.y); await alice.mouse.down(); await alice.mouse.move(destination.x, destination.y, { steps: 8 }); await alice.mouse.up();
    await expect.poll(() => smoke.fixture.snapshot().state.objects.tokens.alice?.x).toBe(385);
    scenarios.push('Canvas free move commits to the real GM store');
    await gm.locator('[data-permission="approval"]').check();
    const from = await worldPoint(alice, 385, 315); const to = await worldPoint(alice, 525, 315);
    await alice.mouse.move(from.x, from.y); await alice.mouse.down(); await alice.mouse.move(to.x, to.y, { steps: 8 }); await alice.mouse.up();
    await alice.getByRole('button', { name: 'Propose movement', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().paths.length).toBe(1);
    expect(smoke.fixture.snapshot().state.objects.tokens.alice?.x).toBe(385);
    await gm.getByRole('button', { name: 'Edit', exact: true }).click();
    const gmCanvas = await gm.locator('#map canvas').boundingBox(); if (!gmCanvas) throw new Error('GM overlay canvas unavailable');
    await gm.mouse.move(gmCanvas.x + 525 / 2, gmCanvas.y + 315 / 2); await gm.mouse.down(); await gm.mouse.move(gmCanvas.x + 455 / 2, gmCanvas.y + 385 / 2, { steps: 8 }); await gm.mouse.up();
    await expect.poll(() => smoke.fixture.snapshot().paths[0]?.points[0]?.x).toBe(455);
    await gm.getByRole('button', { name: 'Done', exact: true }).click();
    const directory = resolve('test-results/player-agency'); await mkdir(directory, { recursive: true });
    const queueFile = resolve(directory, 'gm-path-queue.png'); await gm.screenshot({ path: queueFile }); screenshots.push(queueFile);
    await gm.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().state.objects.tokens.alice?.x).toBe(455);
    await expect.poll(() => smoke.fixture.snapshot().paths.length).toBe(0);
    scenarios.push('Actual pending-path queue and overlay edit then approve without optimistic token movement');
    const cancelFrom = await worldPoint(alice, 455, 385); const cancelTo = await worldPoint(alice, 525, 455);
    await alice.mouse.move(cancelFrom.x, cancelFrom.y); await alice.mouse.down(); await alice.mouse.move(cancelTo.x, cancelTo.y, { steps: 8 }); await alice.mouse.up();
    await alice.getByRole('button', { name: 'Propose movement', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().paths.length).toBe(1);
    await gm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().paths.length).toBe(0);
    expect(smoke.fixture.snapshot().state.objects.tokens.alice?.x).toBe(455);
    scenarios.push('Cancelling a real path leaves the token unchanged');
    await gm.locator('[data-permission="playerConditions"]').check();
    await gm.locator('[data-permission="playerDoors"]').check();
    await alice.getByRole('button', { name: 'Settings', exact: true }).click();
    await alice.getByRole('button', { name: 'Colour 4', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().ownership.players[aliceId]?.colour).toBe(3);
    scenarios.push('Player colour is persisted by GM authority');
    const fright = alice.getByRole('group', { name: 'Alice', exact: true }).getByRole('group', { name: 'Frightened', exact: true });
    await fright.getByRole('button', { name: '+', exact: true }).click();
    await expect(fright.locator('output')).toHaveText('1');
    await fright.getByRole('button', { name: '+', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().state.objects.tokens.alice?.conditionValues?.frightened).toBe(2);
    await fright.getByRole('button', { name: '−', exact: true }).click();
    await expect(fright.locator('output')).toHaveText('1');
    await fright.getByRole('button', { name: '−', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().state.objects.tokens.alice?.conditions?.includes('frightened') ?? false).toBe(false);
    scenarios.push('Allowed valued conditions set and clear through authoritative steppers');
    const playerCancelFrom = await worldPoint(alice, 455, 385); const playerCancelTo = await worldPoint(alice, 525, 455);
    await alice.mouse.move(playerCancelFrom.x, playerCancelFrom.y); await alice.mouse.down(); await alice.mouse.move(playerCancelTo.x, playerCancelTo.y, { steps: 8 }); await alice.mouse.up();
    await alice.getByRole('button', { name: 'Propose movement', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().paths.length).toBe(1);
    const cancelling = smoke.fixture.snapshot().paths[0]!.request;
    const cancellationFile = resolve(directory, 'player-path-pending.png'); await alice.screenshot({ path: cancellationFile }); screenshots.push(cancellationFile);
    await alice.evaluate((text) => {
      const observation: CancelObservation = { seen: false, observer: new MutationObserver(() => {
        if (document.body.textContent?.includes(text)) observation.seen = true;
      }) };
      (window as CancellationWindow).__atlasCancelObservation = observation;
      observation.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, 'Cancellation requested; waiting for confirmation from the table.');
    await alice.getByRole('button', { name: 'Cancel path', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().paths.length, { timeout: 10000 }).toBe(0);
    await expect.poll(() => received.get(alice)!.some((body) => {
      const message = parseGmMessage(JSON.parse(body));
      return message?.t === 'path-result' && message.request === cancelling && message.result === 'cancelled';
    })).toBe(true);
    expect(await alice.evaluate(() => {
      const scope = window as CancellationWindow, observation = scope.__atlasCancelObservation;
      observation?.observer.disconnect();
      delete scope.__atlasCancelObservation;
      return observation?.seen === true;
    })).toBe(true);
    expect(smoke.fixture.snapshot().state.objects.tokens.alice?.x).toBe(455);
    await expect(alice.getByText('Cancellation requested; waiting for confirmation from the table.', { exact: true })).toHaveCount(0);
    scenarios.push('Player cancellation remains queued and visible until the real GM returns a matching path result');
    const scout = alice.locator('.atlas-player__row').filter({ hasText: 'Unclaimed scout' });
    await scout.getByRole('button', { name: 'Request character', exact: true }).click();
    await gm.getByRole('button', { name: 'Accept Unclaimed scout', exact: true }).click();
    await expect.poll(() => smoke.fixture.snapshot().ownership.owners.unclaimed).toBe(aliceId);
    scenarios.push('A real transient claim is accepted by the GM without automatic assignment');
    await alice.getByRole('button', { name: 'Initiative', exact: true }).click();
    await alice.getByRole('button', { name: 'Roll initiative', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Roll initiative', exact: true })).toHaveCount(0);
    const endTurn = alice.getByRole('button', { name: 'End turn', exact: true });
    await expect(endTurn).toBeVisible(); await endTurn.click();
    await expect(endTurn).toHaveCount(0);
    scenarios.push('Owned initiative roll and guarded End turn run through the actual controls');
    await alice.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(alice.getByText('Alice', { exact: true }).first()).toBeVisible();
    const resource = alice.getByRole('spinbutton', { name: 'Hit points', exact: true });
    await resource.fill('7'); await resource.blur();
    await expect.poll(() => smoke.fixture.snapshot().state.objects.tokens.alice?.resources?.hp?.current).toBe(7);
    expect(smoke.fixture.snapshot().state.objects.tokens.alice?.resources?.hp?.max).toBe(12);
    await expect(alice.locator('.atlas-statblock')).toBeVisible();
    await expect(alice.locator('.atlas-player__projection-error')).toHaveCount(0);
    const beforeSheetRolls = smoke.fixture.snapshot().log.filter((entry) => entry.kind === 'roll').length;
    await alice.locator('.atlas-player__sheet-roll > button:first-child').first().click();
    await expect.poll(() => smoke.fixture.snapshot().log.filter((entry) => entry.kind === 'roll').length).toBe(beforeSheetRolls + 1);
    scenarios.push('Native indexed ability rolls and editable book resources use the real sheet projection');
    await alice.getByRole('button', { name: 'Notes', exact: true }).click();
    await alice.getByRole('button', { name: 'New note', exact: true }).click();
    await alice.getByLabel('Title', { exact: true }).fill('Acceptance note');
    await alice.getByLabel('Text', { exact: true }).fill('Written through the real browser book.');
    await alice.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(alice.getByText('Acceptance note', { exact: true })).toBeVisible();
    scenarios.push('Book note write is refreshed by OnlineTable book authority');
    await alice.getByRole('button', { name: 'Quests', exact: true }).click();
    await alice.getByRole('button', { name: 'The lost lantern', exact: false }).click();
    await expect(alice.getByText(/The old road is safe only by daylight/)).toBeVisible();
    await alice.getByRole('button', { name: 'World map', exact: true }).click();
    await alice.getByRole('button', { name: 'Open world map', exact: true }).click();
    await alice.getByRole('button', { name: 'Region', exact: true }).click();
    await alice.getByRole('button', { name: 'Town', exact: true }).click();
    await expect(alice.locator('.atlas-player__surface > header strong').filter({ hasText: 'Town' })).toBeVisible();
    await alice.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Town', exact: true })).toBeVisible();
    await alice.getByRole('button', { name: 'Back', exact: true }).click();
    scenarios.push('Full-text quest assets and two nested world maps are read through the real book');
    await alice.getByRole('button', { name: 'Table log', exact: true }).click();
    await bob.getByRole('button', { name: 'Table log', exact: true }).click();
    const composer = alice.getByRole('combobox', { name: 'Message', exact: true });
    await composer.fill('The lantern is ours.'); await composer.press('Enter');
    await expect(bob.getByText('The lantern is ours.', { exact: true })).toBeVisible();
    await composer.fill('/w Bob Keep the secret arch shut.'); await composer.press('Enter');
    await expect(bob.getByText('Keep the secret arch shut.', { exact: true })).toBeVisible();
    scenarios.push('Actual shared log composer sends public chat and a named whisper');
    for (const [page, name] of [[alice, 'alice-personal'], [bob, 'bob-personal']] as const) {
      const path = resolve(directory, `${name}.png`); await page.screenshot({ path }); screenshots.push(path);
    }
    await smoke.fixture.command({ type: 'move', id: 'alice', x: 665, y: 280 });
    const door = await worldPoint(alice, 700, 280);
    await alice.mouse.click(door.x, door.y);
    await expect.poll(() => smoke.fixture.snapshot().state.objects.walls.door?.closed).toBe(false);
    await alice.mouse.click(door.x, door.y);
    await expect.poll(() => smoke.fixture.snapshot().state.objects.walls.door?.closed).toBe(true);
    await smoke.fixture.command({ type: 'lock', id: 'door', value: true });
    await alice.mouse.click(door.x, door.y);
    await expect.poll(() => received.get(alice)!.some((body) => body.includes('"door-result"') && body.includes('"refused"'))).toBe(true);
    expect(smoke.fixture.snapshot().state.objects.walls.door?.closed).toBe(true);
    scenarios.push('Visible nearby door toggles, while a locked door refuses without revealing its lock');
    await expect.poll(async () => (await browserCache(alice)).rows.some((row) => row.player === aliceId && row.size > 0)).toBe(true);
    const memoryBefore = await browserCache(alice);
    expect(memoryBefore.rows.every((row) => row.player === aliceId && row.geometry === '[1400,1400]')).toBe(true);
    expect((await browserCache(bob)).rows.some((row) => row.player === aliceId)).toBe(false);
    await alice.reload();
    await alice.getByLabel('Your name', { exact: true }).fill('Alice');
    await expect(alice.getByLabel('Join code', { exact: true })).toHaveCount(0);
    await alice.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(alice.getByRole('button', { name: 'Leave and forget', exact: true })).toBeVisible();
    scenarios.push('Browser key survives reload without a second knock');
    await expect.poll(async () => (await browserCache(alice)).rows.some((row) => memoryBefore.rows.some((before) => before.key === row.key))).toBe(true);
    scenarios.push('Personal explored PNG rows survive reload and never appear in the other player context');
    await gm.getByRole('button', { name: 'Restart GM connection', exact: true }).click();
    await expect(gm.locator('#status')).toHaveText('online', { timeout: 30000 });
    await expect(alice.getByText('The GM is offline. Player actions are unavailable.', { exact: true })).toHaveCount(0);
    scenarios.push('GM restart returns fresh readiness-driven pictures without player reconnection');
    await expect(torch).not.toHaveText(initialTorch ?? '');
    scenarios.push('The received running widget timer advances without another widget edit');
    const assetsBeforeForget = (await browserCache(alice)).assets;
    await alice.getByRole('button', { name: 'Leave and forget', exact: true }).click();
    await expect(alice.getByLabel('Table link', { exact: true })).toBeVisible();
    expect(await alice.evaluate((table) => localStorage.getItem(`atlas-player:${table}`), smoke.fixture.connection.table)).toBeNull();
    const forgotten = await browserCache(alice);
    expect(forgotten.rows.some((row) => row.player === aliceId)).toBe(false);
    expect(forgotten.assets).toBeGreaterThanOrEqual(assetsBeforeForget);
    expect(smoke.fixture.snapshot().ownership.owners.alice).toBe(aliceId);
    scenarios.push('Leave and forget clears only this browser identity and personal memory, retaining asset cache and GM ownership');
    return { scenarios, screenshots };
  } catch (error) {
    const directory = resolve('test-results/player-agency'); await mkdir(directory, { recursive: true });
    for (const [index, isolated] of contexts.entries()) for (const page of isolated.pages()) {
      if (!page.isClosed()) await page.screenshot({ path: resolve(directory, `failure-${index}.png`) }).catch(() => undefined);
    }
    throw new Error(`Acceptance failed after: ${scenarios.at(-1) ?? 'startup'}; ${String(error)}`, { cause: error });
  } finally { for (const isolated of contexts) await isolated.close(); await smoke.stop(); }
};
