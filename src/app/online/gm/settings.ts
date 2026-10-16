import type { AtlasSettingSection } from '../../settings/settingSections';
import { DEFAULT_HOST_ORIGIN, readRelayOrigin } from './host/hostSettings.ts';
import type { HostControl } from './host/HostControl.ts';
import { COMPANION_REPORTS_NOTE } from './companionReports.ts';
import { t } from '../../i18n';

export interface OnlineSettings { relayOrigin: string; feedbackEnabled: boolean; reportErrors: boolean; }
export const DEFAULT_SETTINGS: OnlineSettings = { relayOrigin: DEFAULT_HOST_ORIGIN, feedbackEnabled: false, reportErrors: false };
export function readSettings(data: unknown): OnlineSettings {
  const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  return { relayOrigin: readRelayOrigin(record.relayOrigin) ?? DEFAULT_SETTINGS.relayOrigin, feedbackEnabled: record.feedbackEnabled === true, reportErrors: record.reportErrors === true };
}
export interface OnlineSettingsHost { readonly settings: OnlineSettings; readonly host: HostControl; saveSettings(): Promise<void>; }
export function onlineSettingsSections(owner: OnlineSettingsHost): AtlasSettingSection[] {
  const host = owner.host;
  return [{ heading: t('onlinePlayer.onlineHosting'), rows: [
    { name: t('onlinePlayer.relayOrigin'), desc: t('onlinePlayer.relayOriginDescription'), render: (setting) => {
      setting.addText((text) => { text.setValue(owner.settings.relayOrigin).setPlaceholder(DEFAULT_HOST_ORIGIN); });
      setting.addButton((button) => button.setButtonText(t('onlinePlayer.saveRelay')).onClick(() => {
        const input = setting.controlEl.querySelector<HTMLInputElement>('input');
        if (input === null) return;
        const origin = readRelayOrigin(input.value);
        if (origin === null) { setting.setDesc(t('onlinePlayer.invalidRelayOrigin')); return; }
        void host.setOrigin(origin).then((accepted) => {
          if (accepted) {
            input.value = host.origin;
            setting.setDesc(t('onlinePlayer.relayOriginDescription'));
          }
        });
      }));
    } },
    { name: t('onlinePlayer.hostKey'), desc: t('onlinePlayer.hostKeyDescription'), render: (setting) => {
      setting.addText((text) => { text.inputEl.type = 'password'; text.setPlaceholder(t('onlinePlayer.hostKey')); });
      setting.addButton((button) => button.setButtonText(t('onlinePlayer.saveOrReplace')).onClick(() => {
        const input = setting.controlEl.querySelector<HTMLInputElement>('input[type=password]');
        if (input !== null && input.value.trim() !== '') void host.setKey(input.value).then(() => { input.value = ''; void owner.saveSettings(); });
      }));
      setting.addButton((button) => button.setButtonText(t('onlinePlayer.clear')).onClick(() => void host.clearKey().then(() => owner.saveSettings())));
      setting.addButton((button) => button.setButtonText(t('onlinePlayer.checkRelay')).onClick(() => void host.refresh()));
    } },
  ] }, { heading: t('onlinePlayer.onlineDiagnostics'), rows: [
    { name: t('onlinePlayer.sendErrorReports'), desc: COMPANION_REPORTS_NOTE, render: (setting) => setting.addToggle((toggle) => toggle.setValue(owner.settings.reportErrors).onChange((value) => { owner.settings.reportErrors = value; void owner.saveSettings(); })) },
    { name: t('onlinePlayer.enableFeedback'), desc: t('onlinePlayer.feedbackDiscarded'), render: (setting) => setting.addToggle((toggle) => toggle.setValue(owner.settings.feedbackEnabled).onChange((value) => { owner.settings.feedbackEnabled = value; void owner.saveSettings(); })) },
  ] }];
}
