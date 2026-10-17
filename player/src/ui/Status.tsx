import type { ReactElement } from 'react';
import type { PlayerStatus } from '../state/playerStore.ts';
import { playerText } from '../i18n.ts';

export interface StatusProps {
  readonly status: PlayerStatus;
  readonly notice: string | null;
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly identityPersistent: boolean;
  readonly playerName: string | null;
}

function statusLabel(status: PlayerStatus): string {
  if (status === 'connected') return playerText('connected');
  if (status === 'waiting') return playerText('waiting');
  if (status === 'joining') return playerText('joining');
  if (status === 'blocked') return playerText('blocked');
  if (status === 'invalid-table') return playerText('invalidTable');
  return playerText('disconnected');
}

export function Status({ status, notice, gmOnline, busy, identityPersistent, playerName }: StatusProps): ReactElement {
  return <div className="atlas-player__status" data-connected={status === 'connected' && gmOnline} role="status" aria-live="polite">
    <span className="atlas-player__status-dot" aria-hidden="true" />
    <span className="atlas-player__identity">{playerName && <strong>{playerName}</strong>}<span>{statusLabel(status)}</span></span>
    {!gmOnline && status === 'connected' && <span className="atlas-player__status-warning">{playerText('gmOffline')}</span>}
    {busy && <span className="atlas-player__status-warning">{playerText('busy')}</span>}
    {!identityPersistent && <span className="atlas-player__status-warning">{playerText('storageLost')}</span>}
    {notice && <span>{notice}</span>}
  </div>;
}
