import { Setting } from 'obsidian';
import type { ScenePermissions } from '../../protocol/index.ts';
import type { ClaimRequests } from '../claims.ts';
import { textButton } from './controls.ts';
import { t } from '../../../i18n';
import { playerTone } from '../../protocol';

const PERMISSION_LABELS = {
  approval: 'onlinePlayer.approveMovement',
  perPlayerVision: 'onlinePlayer.personalVision',
  playerConditions: 'onlinePlayer.playerConditions',
  playerDoors: 'onlinePlayer.playerDoors',
} as const;

export function renderScenePermissions(parent: HTMLElement, permissions: ScenePermissions, loaded: boolean, change: (key: keyof ScenePermissions, value: boolean) => void): void {
  const section = parent.createDiv({ cls: 'atlas-online-scene-permissions', attr: { role: 'group', 'aria-label': t('onlinePlayer.scenePermissions') } });
  for (const key of Object.keys(PERMISSION_LABELS) as (keyof ScenePermissions)[]) {
    new Setting(section).setName(t(PERMISSION_LABELS[key])).addToggle((toggle) => {
      toggle.setValue(permissions[key]).setDisabled(!loaded).onChange((value) => change(key, value));
      toggle.toggleEl.setAttribute('aria-label', t(PERMISSION_LABELS[key]));
    });
  }
}

export function renderClaimRequests(parent: HTMLElement, claims: ClaimRequests, portrait: (tokenId: string, image: string | null, parent: HTMLElement) => void, colourOf?: (player: string) => number | undefined): void {
  for (const claim of claims.entries()) {
    const row = parent.createDiv({ cls: 'atlas-online-knock', attr: { role: 'group', 'aria-label': t('onlinePlayer.claimRequestLabel', { player: claim.playerName, combatant: claim.tokenName }) } });
    row.createSpan({ cls: `atlas-online-avatar atlas-online-colour-${playerTone(claim.from, colourOf?.(claim.from))}`, text: claim.playerName.trim().slice(0, 1).toUpperCase(), attr: { 'aria-hidden': 'true' } });
    const face = row.createDiv({ cls: 'atlas-online-player__portrait' });
    portrait(claim.tokenId, claim.image, face);
    row.createEl('bdi', { cls: 'atlas-online-knock__text', text: t('onlinePlayer.claimRequestLabel', { player: claim.playerName, combatant: claim.tokenName }) });
    textButton(row, t('onlinePlayer.decline'), () => claims.decline(claim.from, claim.request), 'ghost');
    textButton(row, t('onlinePlayer.accept'), () => claims.accept(claim.from, claim.request), 'cta');
  }
}
