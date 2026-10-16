import { Setting } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { AccountControl } from '../../../../src/app/online/gm/account/AccountControl.ts';
import type { HttpRequest, HttpResponse } from '../../../../src/app/online/gm/account/http.ts';
import { DEFAULT_SETTINGS, onlineSettingsSections, readSettings, type OnlineSettings } from '../../../../src/app/online/gm/settings.ts';
import { TEST_RELAY } from './testRelay.ts';

const MARA = { id: 'acc_mara', handle: 'mara', name: 'Mara' };

describe('online play\'s settings data', () => {
  it('reports no errors until the GM switches it on', () => {
    expect(DEFAULT_SETTINGS).toEqual({ reportErrors: false, relayAddress: '' });
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ reportErrors: 'yes' })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ reportErrors: true })).toEqual({ reportErrors: true, relayAddress: '' });
  });

  it('has no relay address until the GM enters one: nothing is built in', () => {
    expect(DEFAULT_SETTINGS.relayAddress).toBe('');
    expect(readSettings(undefined).relayAddress).toBe('');
    expect(readSettings({}).relayAddress).toBe('');
  });

  it('keeps a relay address only as the origin it normalises to', () => {
    expect(readSettings({ relayAddress: TEST_RELAY }).relayAddress).toBe(TEST_RELAY);
    expect(readSettings({ relayAddress: ` ${TEST_RELAY}/ ` }).relayAddress).toBe(TEST_RELAY);
    expect(readSettings({ relayAddress: 'HTTP://LOCALHOST:8787/' }).relayAddress).toBe('http://localhost:8787');
    for (const unusable of ['http://relay.example', 'https://user:pw@relay.example', 'https://relay.example/path', 'https://relay.example/?q=1', 'https://relay.example/#x', 'ftp://relay.example', 'relay.example', '', '  ', 7, null, true, ['https://relay.example'], { origin: TEST_RELAY }]) {
      expect(readSettings({ relayAddress: unusable }).relayAddress, JSON.stringify(unusable)).toBe('');
    }
  });

  it('keeps nothing of a key that made tables without an account', () => {
    const read = readSettings({ createKey: 'owner-key', reportErrors: false });
    expect(read).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(read)).toEqual(['reportErrors', 'relayAddress']);
  });
});

describe('online play\'s settings', () => {
  /** Online play's settings with a GM signed in. */
  function host(me: HttpResponse): { settings: OnlineSettings; account: AccountControl; saveSettings: () => Promise<void>; opened: string[]; saved: OnlineSettings[]; requests: HttpRequest[] } {
    const settings = { ...DEFAULT_SETTINGS, relayAddress: TEST_RELAY };
    const opened: string[] = [];
    const saved: OnlineSettings[] = [];
    const requests: HttpRequest[] = [];
    let token: string | null = 'tok';
    const account = new AccountControl({
      http: (request) => (requests.push(request), Promise.resolve(me)),
      timers: { now: () => 0, setTimer: () => 0, clearTimer: () => undefined },
      tokens: { get: () => token, set: (next) => (token = next), clear: () => (token = null) },
      openUrl: (url) => void opened.push(url),
      notify: () => undefined,
      relay: () => (settings.relayAddress === '' ? null : settings.relayAddress),
    });
    return { settings, account, opened, saved, requests, saveSettings: () => Promise.resolve(void saved.push({ ...settings })) };
  }

  /** The sections drawn as the settings tab draws them. */
  function draw(of: ReturnType<typeof host>): { headings: string[]; names: string[]; row(name: string): Setting } {
    const sections = onlineSettingsSections(of);
    const rows = new Map<string, Setting>();
    for (const section of sections) {
      for (const row of section.rows) {
        const setting = new Setting(document.body.createDiv()).setName(row.name);
        if (row.desc !== undefined) setting.setDesc(row.desc);
        row.render(setting);
        rows.set(row.name, setting);
      }
    }
    return {
      headings: sections.map((section) => section.heading),
      names: [...rows.keys()],
      row: (name) => {
        const row = rows.get(name);
        if (row === undefined) throw new Error(`no row ${name}`);
        return row;
      },
    };
  }

  const buttonsOf = (setting: Setting): string[] => [...setting.controlEl.querySelectorAll('button')].map((button) => button.textContent ?? '');

  it('have the relay address, the account and error reports, and neither a key that creates tables nor the relay\'s account data', () => {
    const drawn = draw(host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } }));
    expect(drawn.headings).toEqual(['Online relay', 'Online account', 'Online diagnostics']);
    expect(drawn.names).toEqual(['Relay address', 'Atlas account', 'Send error reports']);
  });

  it('say in the account row why the account may not host, with the way to the account page', async () => {
    const of = host({ status: 200, json: { account: MARA, access: null, reason: 'access-revoked' } });
    const row = draw(of).row('Atlas account');
    expect(row.descEl.textContent).toBe('Checking your account…');
    await of.account.refresh(true);
    expect(row.descEl.textContent).toBe('Signed in as Mara (@mara). Your access to online play was withdrawn. See your account page.');
    expect(buttonsOf(row)).toEqual(['Sign out', 'Open account page']);
    row.controlEl.querySelectorAll('button')[1]?.click();
    expect(of.opened).toEqual(['https://atlas-vtt.dev/account']);
    expect(row.controlEl.querySelector('input')).toBeNull();
  });

  it('say what an account that may host holds, asked of Atlas\'s table server', async () => {
    const of = host({ status: 200, json: { account: MARA, access: { plan: 'beta', maxPlayers: 12, endsAt: null } } });
    const row = draw(of).row('Atlas account');
    await of.account.refresh(true);
    expect(row.descEl.textContent).toBe('Signed in as Mara (@mara) · Early access · up to 12 players');
    expect(buttonsOf(row)).toEqual(['Sign out', 'Open account page']);
    expect(of.requests.map((request) => request.url)).toEqual([`${TEST_RELAY}/api/me`]);
  });

  /** The relay address field of a drawn row, and the typing and leaving of it. */
  function addressField(of: ReturnType<typeof host>): { row: Setting; input: HTMLInputElement; type(text: string): void; leave(): Promise<void> } {
    const row = draw(of).row('Relay address');
    const input = row.controlEl.querySelector('input');
    if (input === null) throw new Error('no field');
    return {
      row,
      input,
      type: (text) => {
        input.value = text;
        input.dispatchEvent(new Event('input'));
      },
      leave: async () => {
        input.dispatchEvent(new Event('change'));
        for (let turn = 0; turn < 10; turn++) await Promise.resolve();
      },
    };
  }

  it('hold the relay address in a field that shows what is kept, and say what it is for', () => {
    const of = host({ status: 200, json: null });
    const field = addressField(of);
    expect(field.input.value).toBe(TEST_RELAY);
    expect(field.input.getAttribute('placeholder')).toBe('https://relay.example.com');
    expect(field.row.descEl.textContent).toContain('Nothing is sent anywhere until you enter an address.');
    expect(field.row.controlEl.querySelectorAll('button')).toHaveLength(0);
    const empty = host({ status: 200, json: null });
    empty.settings.relayAddress = '';
    expect(addressField(empty).input.value).toBe('');
  });

  it('keep nothing and ask nobody while an address is typed: a half-typed address is no server the GM chose', async () => {
    const of = host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } });
    const field = addressField(of);
    for (const typed of ['h', 'https://', 'https://other', 'https://other.exa', 'https://other.example']) field.type(typed);
    expect(of.saved).toEqual([]);
    expect(of.settings.relayAddress).toBe(TEST_RELAY);
    expect(of.requests).toEqual([]);
  });

  it('keep the address when the GM leaves the field, as the origin it names, and ask that relay about the account', async () => {
    const of = host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } });
    const field = addressField(of);
    field.type(' HTTPS://Other.Example:8443/ ');
    await field.leave();
    expect(field.input.value).toBe('https://other.example:8443');
    expect(of.settings.relayAddress).toBe('https://other.example:8443');
    expect(of.saved).toEqual([{ reportErrors: false, relayAddress: 'https://other.example:8443' }]);
    expect(of.requests.map((request) => request.url)).toEqual(['https://other.example:8443/api/me']);
    expect(field.row.descEl.textContent).toContain('Nothing is sent anywhere until you enter an address.');
    expect(field.row.descEl.classList.contains('atlas-online-setting-error')).toBe(false);
    // The same address again changes nothing and asks nothing.
    field.type('https://other.example:8443/');
    await field.leave();
    expect(of.saved).toHaveLength(1);
    expect(of.requests).toHaveLength(1);
  });

  it('say why an address is not usable, keep the one before, and ask nobody', async () => {
    const of = host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } });
    const field = addressField(of);
    for (const typed of ['http://relay.example', 'https://user:pw@relay.example', 'https://relay.example/api', 'relay.example', 'https://relay.example/?x=1']) {
      field.type(typed);
      expect(field.row.descEl.textContent, typed).toBe('Not saved. Enter the address of the table server, such as https://relay.example.com: https only (http works for localhost), with no path, query or login.');
      expect(field.row.descEl.classList.contains('atlas-online-setting-error'), typed).toBe(true);
      expect(field.input.getAttribute('aria-invalid'), typed).toBe('true');
      await field.leave();
      expect(field.input.value, typed).toBe(typed);
      expect(of.settings.relayAddress, typed).toBe(TEST_RELAY);
    }
    expect(of.saved).toEqual([]);
    expect(of.requests).toEqual([]);
    // Typing it right again takes the message away.
    field.type('http://localhost:8787');
    expect(field.row.descEl.classList.contains('atlas-online-setting-error')).toBe(false);
    expect(field.input.getAttribute('aria-invalid')).toBe('false');
    expect(field.row.descEl.textContent).toContain('Nothing is sent anywhere');
  });

  it('clear the address when the field is emptied, after which the account is asked of nobody', async () => {
    const of = host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } });
    const field = addressField(of);
    field.type('   ');
    await field.leave();
    expect(of.settings.relayAddress).toBe('');
    expect(of.saved).toEqual([{ reportErrors: false, relayAddress: '' }]);
    expect(field.input.value).toBe('');
    await of.account.refresh(true);
    expect(of.requests).toEqual([]);
    expect(of.account.relay()).toBeNull();
  });
});
