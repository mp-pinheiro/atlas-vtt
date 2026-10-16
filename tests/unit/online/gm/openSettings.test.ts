// @vitest-environment node
import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../../../../src/app/ui/notice', () => ({ showNotice: (text: string) => void notices.push(text) }));

const { openPluginSettings } = await import('../../../../src/app/online/gm/openSettings.ts');

describe('opening a plugin\'s tab of Obsidian\'s settings', () => {
  it('opens the dialog and then the tab of the plugin\'s id', () => {
    const calls: string[] = [];
    const app = { setting: { open: () => void calls.push('open'), openTabById: (id: string) => void calls.push(`tab ${id}`) } } as unknown as App;
    openPluginSettings(app, 'atlas-vtt');
    expect(calls).toEqual(['open', 'tab atlas-vtt']);
    expect(notices).toEqual([]);
  });

  it('tells the GM where to look where Obsidian has no such dialog', () => {
    openPluginSettings({} as unknown as App, 'atlas-vtt');
    expect(notices).toEqual(['Obsidian could not open the settings. Open Settings, then Atlas VTT, and enter the relay address there.']);
  });
});
