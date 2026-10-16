import type { Message } from '../../types';

/** The GM's side of online play (`src/app/online/gm/`): the relay address and the states it brings. */
export const onlineHost = {
  'onlineHost.relay.heading': 'Online relay',
  'onlineHost.relay.name': 'Relay address',
  'onlineHost.relay.desc': 'The table server online play connects to. It also serves the page your players open. Nothing is sent anywhere until you enter an address.',
  'onlineHost.relay.placeholder': 'https://relay.example.com',
  'onlineHost.relay.invalid': 'Not saved. Enter the address of the table server, such as https://relay.example.com: https only (http works for localhost), with no path, query or login.',
  'onlineHost.notice.noRelay': 'Enter the relay address in the settings first.',
} as const satisfies Record<string, Message>;
