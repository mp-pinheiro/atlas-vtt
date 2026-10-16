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
  return <div className="atlas-player__status" role="status" aria-live="polite">
    <strong>{playerName ?? statusLabel(status)}</strong>
    {!gmOnline && status === 'connected' && <span>{playerText('gmOffline')}</span>}
    {busy && <span>{playerText('busy')}</span>}
    {!identityPersistent && <span>{playerText('storageLost')}</span>}
    {notice && <span>{notice}</span>}
  </div>;
}
