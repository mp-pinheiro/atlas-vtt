import type { App } from 'obsidian';
import { t } from '../../i18n';
import { showNotice } from '../../ui/notice';

/**
 * Opens Obsidian's settings on a plugin's tab. Obsidian has no public call for it: its settings
 * dialog (`app.setting`) opens and then shows the tab with the plugin's manifest id, as other
 * plugins do. Where Obsidian no longer has that dialog, the GM is told where to look.
 */
export function openPluginSettings(app: App, pluginId: string): void {
  const dialog = app.setting;
  if (dialog === undefined) {
    showNotice(t('onlineHost.notice.settingsUnavailable'));
    return;
  }
  dialog.open();
  dialog.openTabById(pluginId);
}
