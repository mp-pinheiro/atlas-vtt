import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    atlasAcceptance(): Promise<{ readonly scenarios: readonly string[]; readonly screenshots: readonly string[] }>;
  }
}

it('runs two isolated real player pages against OnlineTable and the local Worker', async () => {
  const result = await commands.atlasAcceptance();
  expect(result.scenarios).toContain('Canvas free move commits to the real GM store');
  expect(result.scenarios).toContain('Actual pending-path queue and overlay edit then approve without optimistic token movement');
  expect(result.scenarios).toContain('GM restart returns fresh readiness-driven pictures without player reconnection');
  expect(result.scenarios).toContain('Player cancellation remains queued and visible until the real GM returns a matching path result');
  expect(result.screenshots).toHaveLength(4);
}, 180000);
