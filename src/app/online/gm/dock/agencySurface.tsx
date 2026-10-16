import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createTokenPortrait } from '../../../packages/components/shared/tokenPortraitElement';
import { resolveMeasurementSettings } from '../../../grid/measurementFormat';
import { t } from '../../../i18n';
import { rendererOf, tokenLabel } from '../atlasView';
import { measurementOf } from '../atlasLighting';
import type { WorkspaceLeaf } from 'obsidian';
import type { DockAgency } from './panelModel';
import { renderClaimRequests, renderScenePermissions } from './agencyRows';
import { PendingPathQueue } from '../paths/PendingPathQueue';

export class DockAgencySurface {
  private current: DockAgency | undefined;
  private cleanups: (() => void)[] = [];
  private root: Root | null = null;
  private revision = 0;
  constructor(private readonly changed: () => void, private readonly imageSrc: (path: string) => string) {}

  sync(agency: DockAgency | undefined): void {
    const before = this.current;
    this.current = agency;
    if (before?.paths === agency?.paths && before?.claims === agency?.claims && before?.store === agency?.store && before?.ownership === agency?.ownership) return;
    this.revision++;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (!agency) return;
    this.cleanups.push(agency.ownership.onChange(this.changed));
    if (agency.claims) this.cleanups.push(agency.claims.onChange(this.changed));
    if (agency.store) this.cleanups.push(agency.store.subscribe(this.changed));
  }

  key(): unknown {
    const agency = this.current;
    const state = agency?.store?.getState();
    return agency ? [this.revision, state?.mapPath, state?.mapLoaded, state?.isMapLoading, state?.grid, agency.ownership.toData(), agency.claims?.entries()] : null;
  }

  clear(): void { this.root?.unmount(); this.root = null; }

  render(parent: HTMLElement, leaf: WorkspaceLeaf | null): void {
    this.clear();
    const agency = this.current;
    if (!agency) return;
    const state = agency.store?.getState();
    const path = state?.mapPath;
    const loaded = !!path && state?.mapLoaded === true && !state.isMapLoading;
    renderScenePermissions(parent, agency.ownership.permissionsFor(path ?? ''), loaded, (key, value) => {
      const current = agency.store?.getState();
      if (current?.mapPath && current.mapLoaded && !current.isMapLoading) agency.ownership.setPermission(current.mapPath, key, value);
    });
    if (agency.claims) renderClaimRequests(parent, agency.claims, (id, image, face) => {
      const token = state?.objects.tokens[id];
      createTokenPortrait(face, { src: image === null ? '' : this.imageSrc(image), alt: '', showRing: token?.showRing ?? false, ringColor: token?.ringColor ?? undefined });
    }, player => agency.ownership.colourOf(player));
    if (!agency.paths || !state?.grid) return;
    this.root = createRoot(parent.createDiv());
    this.root.render(createElement(PendingPathQueue, {
      paths: agency.paths,
      grid: state.grid,
      measurement: measurementOf(leaf === null ? null : rendererOf(leaf)) ?? resolveMeasurementSettings(undefined, state.grid),
      labels: { heading: t('onlinePlayer.pendingPaths'), approve: t('onlinePlayer.approve'), approveAll: t('onlinePlayer.approveAll'), cancelAll: t('onlinePlayer.cancelAll') },
      describe: proposal => t('onlinePlayer.pathLabel', { player: agency.ownership.nameOf(proposal.from) ?? '', combatant: tokenLabel(proposal.token) }),
    }));
  }

  destroy(): void {
    this.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
