import type { HostState } from '../host/HostControl.ts';
import { tableEndText, type LostTable } from '../tableEnd.ts';
import { statusLine, textButton } from './controls.ts';
export interface HostMenuActions { start(): void; retry(): void; }
export function hostActions(host: { refresh(): Promise<void> }): Pick<HostMenuActions, 'retry'> { return { retry: () => void host.refresh() }; }
export function renderHostMenu(layer: HTMLElement, state: HostState, hostKeyConfigured: boolean, starting: boolean, lost: LostTable | null, actions: HostMenuActions): void {
  layer.empty();
  layer.addClass('atlas-online-menu');
  const title = layer.createDiv({ cls: 'atlas-online-text-block' });
  title.createDiv({ cls: 'atlas-online-title', text: 'Online play' });
  title.createDiv({ cls: 'atlas-online-help', text: 'Configure a relay origin and host key in Online settings to start a browser table.' });
  if (lost !== null) statusLine(title, { text: tableEndText(lost), tone: 'red' });
  const messages: Record<HostState, string> = { unconfigured: hostKeyConfigured ? 'A host key is stored; starting a table checks access.' : 'Host key is not configured.', checking: 'Checking relay access…', ready: 'Relay is ready to host.', 'invalid-key': 'The host key was refused.', unreachable: 'The relay could not be reached.', 'secret-storage-unavailable': 'Secure storage is unavailable; hosting is disabled.' };
  statusLine(layer, { text: messages[state], tone: state === 'ready' ? 'green' : state === 'invalid-key' ? 'red' : 'muted' });
  if (state === 'unreachable' || state === 'invalid-key') textButton(layer, 'Check relay', actions.retry);
  const start = textButton(layer, starting ? 'Starting…' : 'Start online table', actions.start, 'cta');
  start.disabled = starting || !hostKeyConfigured || state === 'secret-storage-unavailable' || state === 'invalid-key';
}
