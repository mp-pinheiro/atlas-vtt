// @vitest-environment node
import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../../../../src/app/ui/notice', () => ({ showNotice: (text: string) => void notices.push(text) }));

const { openPluginSettings } = await import('../../../../src/app/online/gm/openSettings.ts');

const UNAVAILABLE = 'Obsidian could not open the settings. Open Settings, then Atlas VTT, and enter the relay address there.';

describe('opening a plugin\'s tab of Obsidian\'s settings', () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it('opens the dialog and then the tab of the plugin\'s id', () => {
    const calls: string[] = [];
    const app = { setting: { open: () => void calls.push('open'), openTabById: (id: string) => void calls.push(`tab ${id}`) } } as unknown as App;
    openPluginSettings(app, 'atlas-vtt');
    expect(calls).toEqual(['open', 'tab atlas-vtt']);
    expect(notices).toEqual([]);
  });

  it('tells the GM where to look where Obsidian has no such dialog', () => {
    openPluginSettings({} as unknown as App, 'atlas-vtt');
    expect(notices).toEqual([UNAVAILABLE]);
  });

  it('tells the GM where to look where the dialog no longer shows a tab by its id, and opens nothing', () => {
    const calls: string[] = [];
    const app = { setting: { open: () => void calls.push('open') } } as unknown as App;
    openPluginSettings(app, 'atlas-vtt');
    expect(calls).toEqual([]);
    expect(notices).toEqual([UNAVAILABLE]);
  });

  it('tells the GM where to look where the dialog no longer opens', () => {
    const calls: string[] = [];
    const app = { setting: { openTabById: (id: string) => void calls.push(`tab ${id}`) } } as unknown as App;
    openPluginSettings(app, 'atlas-vtt');
    expect(calls).toEqual([]);
    expect(notices).toEqual([UNAVAILABLE]);
  });
});
