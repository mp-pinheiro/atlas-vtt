import type { Message } from '../../types';

export const playerApp = {
  'playerApp.title': 'Atlas VTT',
  'playerApp.codeMissing': 'Open the link your GM gave you.',
  'playerApp.tableCode': 'Table code',
} as const satisfies Record<string, Message>;
