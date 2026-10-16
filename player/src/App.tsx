import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { PlayerCanvas } from './canvas/PlayerCanvas.ts';
import { createPlayerRuntime, type PlayerRuntime } from './ui/playerRuntime.ts';
import { JoinPanel } from './ui/JoinPanel.tsx';
import { SourceFooter } from './ui/SourceFooter.tsx';
import { Status } from './ui/Status.tsx';
import { Toolbar, type PlayerTool } from './ui/Toolbar.tsx';
import { BookPanel } from './ui/BookPanel.tsx';
import { DicePanel } from './ui/DicePanel.tsx';
import { InitiativePanel } from './ui/InitiativePanel.tsx';
import { TableLog } from './ui/TableLog.tsx';
import { PlayerSettings } from './ui/PlayerSettings.tsx';
import { WidgetBar } from './ui/WidgetBar.tsx';
import { ShownImage } from './ui/ShownImage.tsx';
import { AgencyPanel } from './ui/AgencyPanel.tsx';
import { AuthoritativeDice } from './ui/AuthoritativeDice.tsx';
import { NativeSheet } from './ui/NativeSheet.tsx';
import { BookTextReader } from './ui/BookTextReader.tsx';
import { CloseButton } from '../../src/app/packages/components/primitives/CloseButton.tsx';
import { playerText } from './i18n.ts';
import './theme.scss';

type Panel = 'tabDice' | 'tabInitiative' | 'tabBook' | 'tabLog' | 'tabSettings';
const panels: readonly Panel[] = ['tabDice', 'tabInitiative', 'tabBook', 'tabLog', 'tabSettings'];

function MapSurface({ runtime, tool, openFound }: { readonly runtime: PlayerRuntime; readonly tool: PlayerTool; readonly openFound: (id: string) => void }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<PlayerCanvas | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const state = useStore(runtime.store);
  const proposal = Object.values(state.proposals)[0];
  const proposalRequest = canvas.current?.proposalRequest;
  const pathFeedback = state.feedback.find((entry) => entry.request === proposalRequest && entry.status === 'pending');
  const pending = pathFeedback !== undefined;
  const cancellationPending = pathFeedback?.cancelInFlight === true;
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const element = host.current;
    if (element === null) return;
    void PlayerCanvas.create({ host: element, assets: runtime.assets, send: runtime.send, table: runtime.table, onNotice: setNotice, openFound }).then((created) => {
      if (!alive) { created.destroy(); return; }
      canvas.current = created;
      created.update(runtime.store.getState());
      unsubscribe = runtime.store.subscribe((state) => created.update(state));
    }).catch(() => { if (alive) setNotice(playerText('unavailable')); });
    return () => { alive = false; unsubscribe?.(); canvas.current?.destroy(); canvas.current = null; };
  }, [runtime]);
  useEffect(() => { if (tool !== 'dice') canvas.current?.setTool(tool); }, [tool]);
  return <><div className="atlas-player__canvas" ref={host} />{notice && <p className="atlas-player__canvas-notice" role="status">{notice}</p>}{proposal && <div className="atlas-player__path-controls atlas-player__surface"><p>{playerText(cancellationPending ? 'pathCancelInFlight' : pending ? 'pathPending' : 'approvalInstructions')}</p><output>{proposal.length}/32</output>{proposal.length >= 32 && <p role="status">{playerText('pathLimit')}</p>}<div className="atlas-player__row"><button type="button" disabled={pending || !state.gmOnline || state.busy} onClick={() => canvas.current?.proposalAction('submit')}>{playerText('proposePath')}</button><button type="button" disabled={pending || proposal.length <= 1} onClick={() => canvas.current?.proposalAction('remove-last')}>{playerText('removeWaypoint')}</button><button type="button" disabled={cancellationPending} onClick={() => canvas.current?.proposalAction('cancel')}>{playerText('cancelPath')}</button></div></div>}</>;
}

function ConnectedApp({ runtime }: { readonly runtime: PlayerRuntime }): ReactElement {
  const state = useStore(runtime.store);
  const [panel, setPanel] = useState<Panel>('tabLog');
  const [tool, setTool] = useState<PlayerTool>('select');
  const [foundId, setFoundId] = useState<string | null>(null);
  const found = state.log.find((entry) => entry.id === foundId && entry.kind === 'found');
  const scene = state.scene;
  const people = state.people?.t === 'people' ? state.people.people : [];
  const leave = (): void => { void runtime.leave().then(() => { location.hash = ''; location.reload(); }); };
  useEffect(() => {
    const stop = (): void => runtime.stop();
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); runtime.stop(); };
  }, [runtime]);
  const footer = <SourceFooter revision={import.meta.env.SOURCE_REVISION ?? ''} sourceUrl={import.meta.env.SOURCE_URL ?? ''} noticesUrl="/THIRD_PARTY_NOTICES.md" />;
  if (state.playerId === null) return <div className="atlas-player"><header className="atlas-player__header"><strong>{playerText('title')}</strong></header><div className="atlas-player__body atlas-player__body--join"><JoinPanel table={runtime.table} hasIdentity={runtime.identity.get().key !== undefined || runtime.identity.get().wait !== undefined} notice={state.notice} onJoin={runtime.join} onForgetIdentity={() => { void runtime.leave().then(() => runtime.store.getState().setStatus('joining')); }} onTableLink={(table) => { location.hash = table; location.reload(); }} /><Status status={state.status} notice={state.notice} gmOnline={state.gmOnline} busy={state.busy} identityPersistent={runtime.identity.persistent} playerName={state.playerName} /></div>{footer}</div>;
  return <div className="atlas-player">
    <header className="atlas-player__header"><Status status={state.status} notice={state.notice} gmOnline={state.gmOnline} busy={state.busy} identityPersistent={runtime.identity.persistent} playerName={state.playerName} /><button type="button" onClick={leave}>{playerText('forget')}</button></header>
    <div className="atlas-player__body">
      <section className="atlas-player__map" aria-label={playerText('tabMap')}><MapSurface runtime={runtime} tool={tool} openFound={setFoundId} /><div className="atlas-player__map-controls"><WidgetBar bar={scene?.widgets ?? null} /><Toolbar active={tool} onSelect={(next) => { setTool(next); if (next === 'dice') setPanel('tabDice'); }} /></div><AuthoritativeDice runtime={runtime} />{!state.gmOnline && <p className="atlas-player__disconnected" role="status">{playerText('gmOffline')}</p>}</section>
      <aside className="atlas-player__panel"><nav className="atlas-player__tabs" aria-label={playerText('controls')}>{panels.map((page) => <button type="button" key={page} aria-pressed={panel === page} onClick={() => setPanel(page)}>{playerText(page)}</button>)}</nav>
        {panel === 'tabDice' && <DicePanel scene={scene?.scene.id ?? null} entries={state.log} gmOnline={state.gmOnline} busy={state.busy} send={runtime.send} />}
        {panel === 'tabInitiative' && <InitiativePanel scene={scene?.scene.id ?? null} initiative={scene?.initiative ?? null} assets={runtime.assets} gmOnline={state.gmOnline} busy={state.busy} send={runtime.send} />}
        {panel === 'tabBook' && <fieldset className="atlas-player__book" disabled={!state.gmOnline || state.busy}><BookPanel key={`${state.book?.character?.name ?? ''}:${state.book?.character?.art?.hash ?? ''}`} book={state.book} assets={runtime.assets} send={runtime.send} renderSheet={(sheet, onRoll) => <NativeSheet sheet={sheet} resources={state.book?.character?.resources ?? []} assets={runtime.assets} onRoll={onRoll} />} /></fieldset>}
        {panel === 'tabLog' && <TableLog state={runtime.log} entries={state.log} people={people} refusal={null} self={state.playerId} scene={scene?.scene.id ?? null} tokens={scene?.tokens ?? null} mine={scene?.mine?.tokens ?? []} gmOnline={state.gmOnline} busy={state.busy} assets={runtime.assets} send={runtime.send} onClose={() => setPanel('tabBook')} onSendRejected={() => runtime.store.getState().setStatus(state.status, playerText('busy'))} />}
        {panel === 'tabSettings' && <><PlayerSettings playerId={state.playerId} people={people} gmOnline={state.gmOnline} busy={state.busy} send={runtime.send} /><AgencyPanel state={state} send={runtime.send} /></>}
      </aside>
    </div><ShownImage message={state.shownImage} assets={runtime.assets} />{footer}
    {found?.kind === 'found' && <div className="atlas-player__found-reader" role="dialog" aria-modal="true" aria-label={found.title}><CloseButton aria-label={playerText('close')} onClick={() => setFoundId(null)} /><BookTextReader title={found.title} opening={found.body} text={found.text} images={found.images} assets={runtime.assets} /></div>}
  </div>;
}

export function App(): ReactElement {
  const fragment = location.hash.slice(1);
  const code = new URLSearchParams(fragment).get('table') ?? fragment;
  const runtime = useMemo(() => TABLE_CODE_PATTERN.test(code) ? createPlayerRuntime(code, location.origin) : null, [code]);
  if (runtime === null) return <div className="atlas-player atlas-player__body--join"><JoinPanel table={null} hasIdentity={false} notice={null} onJoin={() => { throw new Error('A table link is required'); }} onForgetIdentity={() => { location.hash = ''; }} onTableLink={(table) => { if (TABLE_CODE_PATTERN.test(table)) { location.hash = table; location.reload(); } }} /><SourceFooter revision={import.meta.env.SOURCE_REVISION ?? ''} sourceUrl={import.meta.env.SOURCE_URL ?? ''} noticesUrl="/THIRD_PARTY_NOTICES.md" /></div>;
  return <ConnectedApp runtime={runtime} />;
}
