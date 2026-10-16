import type { App, Plugin } from 'obsidian';
import { Setting } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineFeature } from '../../../../src/app/online/gm/OnlineFeature.ts';
import type { OnlineDataFile } from '../../../../src/app/online/gm/onlineData.ts';
import { TEST_RELAY } from './testRelay.ts';

const seen = vi.hoisted(() => ({
  /** The dependencies the dock was mounted with, and what the settings dialog was asked. */
  dockDeps: null as null | { openSettings(): void; account: { relay(): string | null } },
  settings: [] as string[],
  requests: [] as string[],
}));

// The controls that draw on Atlas's views are not under test: they only record what they were given.
vi.mock('../../../../src/app/online/gm/dock/DockMounts.ts', () => ({
  DockMounts: class {
    constructor(_workspace: unknown, deps: NonNullable<typeof seen.dockDeps>) {
      seen.dockDeps = deps;
    }
    sync(): void {}
    dockOf(): undefined {
      return undefined;
    }
    dispose(): void {}
  },
}));
vi.mock('../../../../src/app/online/gm/log/LogMounts.ts', () => ({
  LogMounts: class {
    sync(): void {}
    refresh(): void {}
    logChanged(): void {}
    close(): void {}
    dispose(): void {}
  },
}));
vi.mock('../../../../src/app/online/gm/image/imageTakeover.ts', () => ({
  ImageTakeover: class {
    sync(): void {}
    hide(): void {}
    dispose(): void {}
  },
}));
vi.mock('../../../../src/app/online/gm/image/atlasImageHost.ts', () => ({
  atlasImageDisplay: (): null => null,
  localPlayerWindowOpen: (): boolean => false,
  readShownFile: (): Promise<null> => Promise.resolve(null),
}));
vi.mock('../../../../src/app/services/PlayerLootDisplay', () => ({ PlayerLootDisplay: { get: () => ({ setOutlet: (): void => undefined }) } }));
vi.mock('../../../../src/app/online/gm/account/obsidianHttp.ts', () => ({
  obsidianHttp: (request: { url: string }) => {
    seen.requests.push(request.url);
    return Promise.resolve({ status: 200, json: { account: { id: 'acc_mara', handle: 'mara', name: 'Mara' }, access: null, reason: 'no-access' } });
  },
}));

const CODE = 'a'.repeat(26);
const SECRET = 's'.repeat(43);

interface Loaded {
  readonly feature: OnlineFeature;
  /** Everything the feature wrote to its data file, in order. */
  readonly written: Record<string, unknown>[];
}

/** Online play loaded with `data` in its data file, as the plugin loads it while the experimental switch is on. */
async function load(data: unknown): Promise<Loaded> {
  const written: Record<string, unknown>[] = [];
  const file: OnlineDataFile = {
    read: () => Promise.resolve(data),
    write: (next) => Promise.resolve(void written.push(next as Record<string, unknown>)),
  };
  const app = {
    workspace: { onLayoutReady: (run: () => void) => run(), on: () => ({}), getLeavesOfType: () => [] },
    vault: { adapter: { getResourcePath: (path: string) => path } },
    secretStorage: { getSecret: () => 'account-token', setSecret: (): void => undefined },
    setting: { open: () => void seen.settings.push('open'), openTabById: (id: string) => void seen.settings.push(id) },
  } as unknown as App;
  const plugin = { app, manifest: { id: 'atlas-vtt', version: '0.0.1' } } as unknown as Plugin;
  const feature = new OnlineFeature(plugin, file);
  feature.onload();
  await vi.waitFor(() => expect(feature.settingsSections()).not.toEqual([]));
  return { feature, written };
}

/** The relay address row of the loaded feature's settings, drawn as the settings tab draws it. */
function relayRow(feature: OnlineFeature): { setting: Setting; input: HTMLInputElement } {
  const row = feature.settingsSections().flatMap((section) => section.rows).find((candidate) => candidate.name === 'Relay address');
  if (row === undefined) throw new Error('no relay row');
  const setting = new Setting(document.body.createDiv()).setName(row.name);
  row.render(setting);
  const input = setting.controlEl.querySelector('input');
  if (input === null) throw new Error('no field');
  return { setting, input };
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
};

describe('online play\'s relay address', () => {
  beforeEach(() => {
    seen.dockDeps = null;
    seen.settings.length = 0;
    seen.requests.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is empty on a first load: no relay for the account, none for a table, and nothing asked of any server', async () => {
    const { feature, written } = await load(null);
    feature.settingsSections();
    expect(feature.settings.relayAddress).toBe('');
    expect(feature.account.relay()).toBeNull();
    expect(feature.online.hasRelay()).toBe(false);
    await feature.account.refresh(true);
    expect(seen.requests).toEqual([]);
    expect(written).toEqual([]);
    feature.unload();
  });

  it('is read from the data file as an origin, reaches the account check, and an address that is not one reads as none', async () => {
    const kept = await load({ relayAddress: ` ${TEST_RELAY}/ ` });
    expect(kept.feature.account.relay()).toBe(TEST_RELAY);
    expect(kept.feature.online.hasRelay()).toBe(true);
    // The question every start asks of the relay about the account, once the layout is ready.
    await settle();
    expect(seen.requests).toEqual([`${TEST_RELAY}/api/me`]);
    kept.feature.unload();

    const hostile = await load({ relayAddress: 'http://attacker.example/steal?x=1' });
    expect(hostile.feature.account.relay()).toBeNull();
    expect(hostile.feature.settings.relayAddress).toBe('');
    hostile.feature.unload();
  });

  it('is kept in the data file when the GM enters it, beside the rest, and the account is asked of that relay', async () => {
    const { feature, written } = await load({ reportErrors: true });
    const { input } = relayRow(feature);
    input.value = 'http://localhost:8787';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(feature.account.relay()).toBe('http://localhost:8787');
    expect(written.at(-1)).toMatchObject({ reportErrors: true, relayAddress: 'http://localhost:8787', table: null });
    expect(seen.requests).toEqual(['http://localhost:8787/api/me']);
    feature.unload();
  });

  it('forgets a table saved before its relay was kept when no address is entered, and writes the data without it', async () => {
    const { feature, written } = await load({ table: { code: CODE, secret: SECRET, maxPlayers: 12 } });
    await settle();
    expect(feature.table).toBeNull();
    expect(written.at(-1)).toMatchObject({ table: null });
    expect(seen.requests).toEqual([]);
    feature.unload();
  });

  it('does not read a table whose relay is not a relay address: it is not resumed, and the next save writes it away', async () => {
    const { feature, written } = await load({ relayAddress: TEST_RELAY, table: { code: CODE, secret: SECRET, maxPlayers: 12, origin: 'http://attacker.example' } });
    await settle();
    expect(feature.table).toBeNull();
    expect(written).toEqual([]);
    await feature.saveSettings();
    expect(written.at(-1)).toMatchObject({ relayAddress: TEST_RELAY, table: null });
    expect(JSON.stringify(written)).not.toContain(SECRET);
    feature.unload();
  });

  it('opens Atlas\'s tab of the settings from the dock', async () => {
    const { feature } = await load(null);
    seen.dockDeps?.openSettings();
    expect(seen.settings).toEqual(['open', 'atlas-vtt']);
    expect(seen.dockDeps?.account.relay()).toBeNull();
    feature.unload();
  });
});
