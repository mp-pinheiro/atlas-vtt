// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionDiagnostics, type CompanionFacts } from '../../../../src/app/online/gm/companionDiagnostics.ts';
import { TEST_RELAY_ORIGIN } from './relayFixture.ts';

const sent: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
vi.mock('obsidian', () => ({ apiVersion: '1.14.4', Platform: { isMacOS: true, isWin: false, isLinux: false }, requestUrl: (request: { url: string; body: string }) => { sent.push({ url: request.url, body: JSON.parse(request.body) as Record<string, unknown> }); return Promise.resolve({ status: 204 }); } }));
class FakeWindow extends EventTarget {}
function companion(overrides: Partial<CompanionFacts> = {}): { diagnostics: CompanionDiagnostics; win: FakeWindow } {
  const facts: CompanionFacts = { reportErrors: () => true, setReportErrors: () => undefined, feedbackEnabled: () => true, relayOrigin: () => TEST_RELAY_ORIGIN, hostKey: () => 'configured-host-key', table: () => ({ code: 'abcdefghijklmno', secret: 'host-secret-private', gate: { code: '483912' } }), playerNames: () => ['Alice'], connection: () => null, ...overrides };
  const diagnostics = new CompanionDiagnostics(facts, '0.0.1', () => '0.6.1');
  const win = new FakeWindow();
  diagnostics.listen(win as unknown as Window);
  return { diagnostics, win };
}
function ownError(message: string): Error { const error = new Error(message); error.stack = `Error: ${message}\n    at SceneShare.send (plugin:atlas-vtt:4242:17)`; return error; }
async function capture(diagnostics: CompanionDiagnostics, win: FakeWindow, error: Error): Promise<void> {
  const observed = vi.spyOn(diagnostics.reporter, 'capture');
  win.dispatchEvent(Object.assign(new Event('error'), { error }));
  const result = observed.mock.results[0];
  if (result === undefined || result.type !== 'return') throw new Error('The diagnostic event was not captured');
  await result.value;
  observed.mockRestore();
}
beforeEach(() => { sent.length = 0; vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe('configured relay diagnostics', () => {
  it('sends error reports only when opted in and redacts table secrets', async () => {
    const { diagnostics, win } = companion();
    await capture(diagnostics, win, ownError('bad configured-host-key host-secret-private abcdefghijklmno Alice'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${TEST_RELAY_ORIGIN}/api/reports`);
    expect(JSON.stringify(sent)).not.toContain('host-secret-private');
    expect(JSON.stringify(sent)).not.toContain('abcdefghijklmno');
    expect(JSON.stringify(sent)).not.toContain('configured-host-key');
  });
  it('does not send automatic errors when disabled', async () => {
    const { diagnostics, win } = companion({ reportErrors: () => false });
    await capture(diagnostics, win, ownError('disabled'));
    expect(sent).toEqual([]);
  });
  it('does not post feedback until explicitly enabled', async () => {
    const { diagnostics } = companion({ feedbackEnabled: () => false });
    expect(await diagnostics.send('feedback text', false)).toBe('failed');
    expect(sent).toEqual([]);
    expect(diagnostics.enabled()).toBe(false);
  });
  it('posts enabled feedback to the configured relay, whose response is treated as discarded', async () => {
    const { diagnostics } = companion({ relayOrigin: () => 'https://relay.example' });
    expect(await diagnostics.send('feedback text', false)).toBe('sent');
    expect(sent.map((entry) => entry.url)).toEqual(['https://relay.example/api/feedback']);
    expect(diagnostics.enabled()).toBe(true);
  });
});
