import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { BookOpen, Compass, Dices, LogOut, MessagesSquare, Settings2, ShieldCheck, Swords } from 'lucide-react';
import { useStore } from 'zustand';
import { TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { Button } from '../../src/app/packages/components/primitives/button.tsx';
import { handledByAnotherControl } from '../../src/app/keyboard/tooltipEscape.ts';
import { CloseButton } from '../../src/app/packages/components/primitives/CloseButton.tsx';
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
import { PlayerDialog } from './ui/PlayerDialog.tsx';
import { usePlayerTheme, type PlayerTheme } from './ui/usePlayerTheme.ts';
import { playerText } from './i18n.ts';
import './theme.scss';

type Panel = 'tabBook' | 'tabLog' | 'tabInitiative' | 'tabDice' | 'tabSettings';
const PANELS = [
  { id: 'tabBook', icon: BookOpen },
  { id: 'tabLog', icon: MessagesSquare },
  { id: 'tabInitiative', icon: Swords },
  { id: 'tabDice', icon: Dices },
  { id: 'tabSettings', icon: Settings2 },
] as const;
const NO_PEOPLE = [] as const;
const NO_TOKEN_IDS = [] as const;
const SOURCE_REVISION: unknown = import.meta.env.SOURCE_REVISION;
const SOURCE_URL: unknown = import.meta.env.SOURCE_URL;
const sourceFooter = <SourceFooter revision={typeof SOURCE_REVISION === 'string' ? SOURCE_REVISION : ''} sourceUrl={typeof SOURCE_URL === 'string' ? SOURCE_URL : ''} noticesUrl="/THIRD_PARTY_NOTICES.md" />;

function MapSurface({ runtime, tool, openFound, canvas }: { readonly runtime: PlayerRuntime; readonly tool: PlayerTool; readonly openFound: (id: string) => void; readonly canvas: { current: PlayerCanvas | null } }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const state = useStore(runtime.store);
  const proposal = Object.values(state.proposals)[0];
  const pathFeedback = state.feedback.find((entry) => entry.request === canvas.current?.proposalRequest && entry.status === 'pending');
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
      unsubscribe = runtime.store.subscribe((next) => created.update(next));
    }).catch(() => { if (alive) setNotice(playerText('unavailable')); });
    return () => { alive = false; unsubscribe?.(); canvas.current?.destroy(); canvas.current = null; };
  }, [runtime, openFound, canvas]);
  useEffect(() => { if (tool !== 'dice') canvas.current?.setTool(tool); }, [tool]);
  useEffect(() => {
    const observer = new MutationObserver(() => canvas.current?.update(runtime.store.getState()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [runtime, canvas]);
  return <>
    <div className="atlas-player__canvas" ref={host} />
    {notice && <p className="atlas-player__canvas-notice" role="status">{notice}</p>}
    {proposal && <div className="atlas-player__path-controls atlas-player__surface">
      <div className="atlas-player__row"><strong>{playerText(cancellationPending ? 'pathCancelInFlight' : pending ? 'pathPending' : 'proposePath')}</strong><output>{proposal.length}/32</output></div>
      {!pending && <p className="atlas-player__muted">{playerText('approvalInstructions')}</p>}
      {proposal.length >= 32 && <p role="status">{playerText('pathLimit')}</p>}
      <div className="atlas-player__row">
        <Button type="button" disabled={pending || !state.gmOnline || state.busy} onClick={() => canvas.current?.proposalAction('submit')}>{playerText('proposePath')}</Button>
        <Button type="button" variant="secondary" disabled={pending || proposal.length <= 1} onClick={() => canvas.current?.proposalAction('remove-last')}>{playerText('removeWaypoint')}</Button>
        <Button type="button" variant="ghost" disabled={cancellationPending} onClick={() => canvas.current?.proposalAction('cancel')}>{playerText('cancelPath')}</Button>
      </div>
    </div>}
  </>;
}

interface ConnectedAppProps {
  readonly runtime: PlayerRuntime;
  readonly theme: PlayerTheme;
  readonly onThemeChange: (theme: PlayerTheme) => void;
}

function ConnectedApp({ runtime, theme, onThemeChange }: ConnectedAppProps): ReactElement {
  const state = useStore(runtime.store);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [visited, setVisited] = useState<readonly Panel[]>([]);
  const [tool, setTool] = useState<PlayerTool>('select');
  const [foundId, setFoundId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { unread } = useSyncExternalStore(runtime.log.subscribe, runtime.log.snapshot);
  const navigation = useRef<HTMLElement>(null);
  const canvas = useRef<PlayerCanvas | null>(null);
  const found = state.log.find((entry) => entry.id === foundId && entry.kind === 'found');
  const scene = state.scene;
  const people = state.people?.t === 'people' ? state.people.people : NO_PEOPLE;
  const openPanel = (next: Panel): void => {
    setPanel((current) => current === next ? null : next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
  };
  const closePanel = (): void => {
    const trigger = navigation.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    setPanel(null);
    trigger?.focus({ preventScroll: true });
  };
  const leave = (): void => { void runtime.leave().then(() => { location.hash = ''; location.reload(); }); };
  useEffect(() => {
    const stop = (): void => runtime.stop();
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); runtime.stop(); };
  }, [runtime]);
  if (state.playerId === null) return <div className="atlas-player atlas-player--joining">
    <div className="atlas-player__join-stage">
      <div className="atlas-player__join-card"><JoinPanel table={runtime.table} hasIdentity={runtime.identity.get().key !== undefined || runtime.identity.get().wait !== undefined} notice={state.notice} status={state.status} onJoin={(input) => runtime.join(input)} onForgetIdentity={() => { void runtime.leave().then(() => runtime.store.getState().setStatus('joining')); }} onTableLink={(table) => { location.hash = table; location.reload(); }} /></div>
      {state.status !== 'joining' && <Status status={state.status} notice={null} gmOnline={state.gmOnline} busy={state.busy} identityPersistent={runtime.identity.persistent} playerName={null} />}
    </div>
    {sourceFooter}
  </div>;
  return <div className="atlas-player" data-panel-open={panel !== null} onKeyDown={(event): void => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !handledByAnotherControl(event.nativeEvent) && document.querySelector('dialog[open]') === null && panel !== null) {
      event.preventDefault();
      closePanel();
    }
  }}>
    <header className="atlas-player__header">
      <div className="atlas-player__brand"><Compass aria-hidden="true" /><span>Atlas <small>{playerText('playerView')}</small></span></div>
      <nav ref={navigation} className="atlas-player__navigation" aria-label={playerText('controls')}>
        {PANELS.map(({ id, icon: Icon }) => <Button type="button" variant="ghost" key={id} aria-pressed={panel === id} aria-expanded={panel === id} aria-controls="atlas-player-panel" className="atlas-player__nav-button" onClick={() => openPanel(id)}>
          <Icon aria-hidden="true" /><span>{playerText(id)}</span>{id === 'tabLog' && unread > 0 && <span className="atlas-player__unread" aria-hidden="true">{Math.min(unread, 99)}</span>}
        </Button>)}
      </nav>
      <Status status={state.status} notice={null} gmOnline={state.gmOnline} busy={state.busy} identityPersistent={runtime.identity.persistent} playerName={state.playerName} />
    </header>
    <main className="atlas-player__body">
      <section className="atlas-player__map" aria-label={playerText('tabMap')}>
        <MapSurface runtime={runtime} tool={tool} openFound={setFoundId} canvas={canvas} />
        {scene === null && state.gmOnline && <div className="atlas-player__map-empty" role="status"><Compass aria-hidden="true" /><h2>{playerText('noActiveScene')}</h2></div>}
        <div className="atlas-player__map-context"><ShieldCheck aria-hidden="true" /><span>{playerText(scene?.scene.personal ? 'personalVision' : 'sharedView')}</span></div>
        <div className="atlas-player__map-controls">
          <WidgetBar bar={scene?.widgets ?? null} />
          <Toolbar active={tool} diceOpen={panel === 'tabDice'} onSelect={(next) => { if (next === 'dice') openPanel('tabDice'); else setTool(next); }} onFit={() => canvas.current?.fitMap()} />
        </div>
        <AuthoritativeDice runtime={runtime} surface={panel === 'tabDice' ? 'tray' : panel === 'tabLog' ? 'log' : panel === null ? 'map' : 'panel'} />
        {!state.gmOnline && <p className="atlas-player__disconnected" role="status">{playerText('gmOffline')}</p>}
        {state.notice && <p className="atlas-player__canvas-notice" role="status">{state.notice}</p>}
      </section>
      <aside id="atlas-player-panel" className="atlas-player__panel" hidden={panel === null} aria-label={panel === null ? undefined : playerText(panel)}>
        <div className="atlas-player__panel-frame">
          <header className="atlas-player__panel-header"><h1>{panel === null ? '' : playerText(panel)}</h1><CloseButton aria-label={playerText('close')} onClick={closePanel} /></header>
          <div className="atlas-player__panel-content">
            {visited.includes('tabDice') && <div className="atlas-player__panel-page" hidden={panel !== 'tabDice'}><DicePanel scene={scene?.scene.id ?? null} entries={state.log} gmOnline={state.gmOnline} busy={state.busy} send={runtime.send} /></div>}
            {visited.includes('tabInitiative') && <div className="atlas-player__panel-page" hidden={panel !== 'tabInitiative'}><InitiativePanel scene={scene?.scene.id ?? null} initiative={scene?.initiative ?? null} assets={runtime.assets} gmOnline={state.gmOnline} busy={state.busy} send={runtime.send} /></div>}
            {visited.includes('tabBook') && <div className="atlas-player__panel-page" hidden={panel !== 'tabBook'}><BookPanel key={`${state.book?.character?.name ?? ''}:${state.book?.character?.art?.hash ?? ''}`} book={state.book} assets={runtime.assets} send={runtime.send} disabled={!state.gmOnline || state.busy} characterControls={<AgencyPanel state={state} send={runtime.send} />} renderSheet={(sheet, onRoll) => <NativeSheet sheet={sheet} resources={state.book?.character?.resources ?? []} assets={runtime.assets} onRoll={(index, mode) => state.gmOnline && !state.busy && onRoll(index, mode)} />} /></div>}
            {panel === 'tabLog' && <div className="atlas-player__panel-page atlas-player__panel-page--log"><TableLog state={runtime.log} entries={state.log} people={people} refusal={null} self={state.playerId} scene={scene?.scene.id ?? null} tokens={scene?.tokens ?? null} mine={scene?.mine?.tokens ?? NO_TOKEN_IDS} gmOnline={state.gmOnline} busy={state.busy} assets={runtime.assets} send={runtime.send} onClose={closePanel} onSendRejected={() => runtime.store.getState().setStatus(state.status, playerText('busy'))} /></div>}
            {visited.includes('tabSettings') && <div className="atlas-player__panel-page" hidden={panel !== 'tabSettings'}>
              <PlayerSettings playerId={state.playerId} people={people} gmOnline={state.gmOnline} busy={state.busy} send={runtime.send} theme={theme} onThemeChange={onThemeChange} />
              <section className="atlas-player__section"><h2>{playerText('tableSession')}</h2><p className="atlas-player__muted">{playerText('forgetHelp')}</p><Button type="button" variant="outline" className="atlas-player__leave" onClick={() => setLeaving(true)}><LogOut aria-hidden="true" />{playerText('leaveTable')}</Button></section>
              <section className="atlas-player__section atlas-player__about"><h2>{playerText('about')}</h2><a href="https://github.com/ByteMirror/atlas-vtt-theme" target="_blank" rel="noopener noreferrer">{playerText('themeCredit')}</a>{sourceFooter}</section>
            </div>}
          </div>
        </div>
      </aside>
    </main>
    <ShownImage message={state.shownImage} assets={runtime.assets} />
    {found?.kind === 'found' && <PlayerDialog title={found.title} onClose={() => setFoundId(null)}><BookTextReader title={found.title} opening={found.body} text={found.text} images={found.images} assets={runtime.assets} /></PlayerDialog>}
    {leaving && <PlayerDialog title={playerText('leaveConfirmTitle')} onClose={() => setLeaving(false)}><p>{playerText('forgetHelp')}</p><div className="atlas-player__dialog-actions"><Button type="button" variant="secondary" onClick={() => setLeaving(false)}>{playerText('cancel')}</Button><Button type="button" variant="destructive" onClick={leave}>{playerText('forget')}</Button></div></PlayerDialog>}
  </div>;
}

export function App(): ReactElement {
  const fragment = location.hash.slice(1);
  const code = new URLSearchParams(fragment).get('table') ?? fragment;
  const runtime = useMemo(() => TABLE_CODE_PATTERN.test(code) ? createPlayerRuntime(code, location.origin) : null, [code]);
  const [theme, onThemeChange] = usePlayerTheme();
  if (runtime === null) return <div className="atlas-player atlas-player--joining"><div className="atlas-player__join-stage"><div className="atlas-player__join-card"><JoinPanel table={null} hasIdentity={false} notice={null} onJoin={() => { throw new Error('A table link is required'); }} onForgetIdentity={() => { location.hash = ''; }} onTableLink={(table) => { if (TABLE_CODE_PATTERN.test(table)) { location.hash = table; location.reload(); } }} /></div></div>{sourceFooter}</div>;
  return <ConnectedApp runtime={runtime} theme={theme} onThemeChange={onThemeChange} />;
}
