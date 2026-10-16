import { useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { Button } from '../../../packages/components/primitives/button';
import { t } from '../../../i18n';
import { pathLengthInCells, type GridGeometry } from '../../../grid/gridDistance';
import { formatDistance, type MeasurementSettings } from '../../../grid/measurementFormat';
import type { PendingPaths, PendingPath } from '../PendingPaths';
import './pendingPaths.scss';

export interface PathQueueLabels {
  readonly heading: string;
  readonly approve: string;
  readonly approveAll: string;
  readonly cancelAll: string;
}
export interface PendingPathQueueProps {
  readonly paths: Pick<PendingPaths, 'subscribe' | 'getSnapshot' | 'editingRequest' | 'approve' | 'cancel' | 'approveAll' | 'cancelAll' | 'beginEdit' | 'endEdit'>;
  readonly grid: GridGeometry;
  readonly measurement: MeasurementSettings;
  readonly labels: PathQueueLabels;
  describe(path: PendingPath): string;
}
export function PendingPathQueue({ paths, grid, measurement, labels, describe }: PendingPathQueueProps): ReactElement | null {
  const proposals = useSyncExternalStore(paths.subscribe, paths.getSnapshot);
  useEffect(() => () => paths.endEdit(false), [paths]);
  if (proposals.length === 0) return null;
  return <section className="atlas-pending-paths" aria-label={labels.heading} onKeyDown={event => {
    if (event.key === 'Escape' && paths.editingRequest !== null) { event.preventDefault(); event.stopPropagation(); paths.endEdit(false); }
  }}>
    <header className="atlas-pending-paths__header"><strong>{labels.heading}</strong><Button onClick={() => paths.approveAll()}>{labels.approveAll}</Button><Button onClick={() => paths.cancelAll()}>{labels.cancelAll}</Button></header>
    {proposals.map(path => <article className="atlas-pending-paths__row" key={path.request}>
      <span>{describe(path)}</span><output>{formatDistance(pathLengthInCells(grid, [path.start, ...path.points], measurement.diagonalRule), measurement)}</output>
      <div className="atlas-pending-paths__actions">
        <Button onClick={() => paths.approve(path.request)}>{labels.approve}</Button>
        {paths.editingRequest === path.request ? <><Button onClick={() => paths.endEdit(true)}>{t('common.done')}</Button><Button onClick={() => paths.endEdit(false)}>{t('common.cancel')}</Button></> : <Button onClick={() => paths.beginEdit(path.request)}>{t('common.edit')}</Button>}
        <Button onClick={() => paths.cancel(path.request)}>{t('common.cancel')}</Button>
      </div>
    </article>)}
  </section>;
}
