import type { Setting } from 'obsidian';
import { t } from '../../i18n';
import type { AtlasSettingSection } from '../../settings/settingSections';
import { normalizeRelayAddress } from './relayAddress.ts';

/** What the relay address row reads and changes. */
export interface RelayAddressHost {
  readonly settings: { relayAddress: string };
  /** Told after a new address was saved, so what the old relay said of the account is dropped and the new relay is asked. */
  readonly account: { relayChanged(): void };
  saveSettings(): Promise<void>;
}

/**
 * The row's text field. Typing only checks the text and says what is wrong with it; the address is
 * kept when the GM leaves the field or presses Enter, and never before: a half-typed address would
 * otherwise be asked for the account at every keystroke, a request to a server the GM never chose.
 */
function renderAddress(setting: Setting, host: RelayAddressHost): void {
  setting.addText((text) => {
    const input = text.inputEl;
    text.setPlaceholder(t('onlineHost.relay.placeholder')).setValue(host.settings.relayAddress);
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    /** Shows the row's note for `typed`; whether it is an address, or empty (no address is a choice too). */
    const check = (typed: string): boolean => {
      const usable = typed.trim() === '' || normalizeRelayAddress(typed) !== null;
      setting.setDesc(usable ? t('onlineHost.relay.desc') : t('onlineHost.relay.invalid'));
      setting.descEl.classList.toggle('atlas-online-setting-error', !usable);
      input.setAttribute('aria-invalid', String(!usable));
      return usable;
    };
    text.onChange((typed) => void check(typed));
    input.addEventListener('change', () => {
      if (!check(input.value)) return;
      const address = normalizeRelayAddress(input.value) ?? '';
      // The field shows what is kept: the origin, without a trailing slash.
      input.value = address;
      if (address === host.settings.relayAddress) return;
      host.settings.relayAddress = address;
      void host.saveSettings().then(() => host.account.relayChanged());
    });
  });
}

/** The settings' Online relay section: the address of the table server online play connects to. */
export function relayAddressSections(host: RelayAddressHost): AtlasSettingSection[] {
  return [{
    heading: t('onlineHost.relay.heading'),
    rows: [{
      name: t('onlineHost.relay.name'),
      desc: t('onlineHost.relay.desc'),
      aliases: ['relay', 'server', 'address', 'url', 'host', 'online', 'table'],
      render: (setting) => renderAddress(setting, host),
    }],
  }];
}
