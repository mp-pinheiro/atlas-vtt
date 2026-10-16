import type { ReactElement } from 'react';
import type { LogEntry } from '../protocol/index.ts';
import { t } from '../../i18n';

export function ActionRow({ entry, time }: { readonly entry: Extract<LogEntry, { kind: 'action' }>; readonly time: string }): ReactElement {
  const player = entry.player ?? t('onlinePlayer.actionPlayer');
  const combatant = entry.combatant ?? t('onlinePlayer.actionToken');
  const text: Record<typeof entry.action, string> = {
    'claim-request': t('onlinePlayer.actionClaimRequest', { player, combatant }),
    'claim-accepted': t('onlinePlayer.actionClaimAccepted', { player, combatant }),
    'claim-declined': t('onlinePlayer.actionClaimDeclined', { player, combatant }),
    'turn-ended': t('onlinePlayer.actionTurnEnded', { combatant }),
    'approval-reminder': t('onlinePlayer.actionApprovalReminder', { player, combatant }),
  };
  return <div className="atlas-online-log__presence"><span>{text[entry.action]}</span><span className="atlas-online-log__time">{time}</span></div>;
}
