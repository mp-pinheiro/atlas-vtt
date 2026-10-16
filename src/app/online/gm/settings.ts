import type { AtlasSettingSection } from '../../settings/settingSections';
import type { AccountControl } from './account/AccountControl.ts';
import { accountSections } from './account/accountSettings.ts';
import { COMPANION_REPORTS_NOTE } from './companionReports.ts';
import { normalizeRelayAddress } from './relayAddress.ts';
import { relayAddressSections } from './relayAddressSettings.ts';

export interface OnlineSettings {
  /** Whether this plugin's errors are reported to the relay; off until the GM switches it on. */
  reportErrors: boolean;
  /** The relay online play connects to, as an origin (`normalizeRelayAddress`); empty until the GM enters one, and nothing is sent anywhere before. */
  relayAddress: string;
}

export const DEFAULT_SETTINGS: OnlineSettings = { reportErrors: false, relayAddress: '' };

/** Settings read from the plugin's data, each field checked; a relay address is kept only as the origin it normalises to. */
export function readSettings(data: unknown): OnlineSettings {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const address = typeof record.relayAddress === 'string' ? normalizeRelayAddress(record.relayAddress) : null;
  return { reportErrors: record.reportErrors === true, relayAddress: address ?? '' };
}

/** What online play's settings rows read and change. */
export interface OnlineSettingsHost {
  readonly settings: OnlineSettings;
  readonly account: AccountControl;
  saveSettings(): Promise<void>;
}

/** Online play's sections of Atlas's settings: the relay, the account and error reports. */
export function onlineSettingsSections(host: OnlineSettingsHost): AtlasSettingSection[] {
  const save = async (change: (settings: OnlineSettings) => void): Promise<void> => {
    change(host.settings);
    await host.saveSettings();
  };
  const settings = host.settings;
  return [
    ...relayAddressSections(host),
    ...accountSections(host.account),
    {
      heading: 'Online diagnostics',
      rows: [{
        name: 'Send error reports',
        desc: COMPANION_REPORTS_NOTE,
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(settings.reportErrors).onChange((value) => void save((current) => (current.reportErrors = value))));
        },
      }],
    },
  ];
}
