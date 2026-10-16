import { CloseButton } from '../../../src/app/packages/components/primitives/CloseButton.tsx';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { TableLogPanel } from '../../../src/app/online/tableLog/TableLogPanel.tsx';
import { LogState } from '../../../src/app/online/tableLog/LogState.ts';
import type { LogActions, Portrait, SpeakerOption, RollFace } from '../../../src/app/online/tableLog/panelTypes.ts';
import type { ChatRefusal, FoundEntry, ImageEntry, LogEntry, RollEntry } from '../../../src/app/online/protocol/log.ts';
import type { LogSpeaker, TablePerson } from '../../../src/app/online/protocol/chat.ts';
import type { PlayerTokens } from '../state/playerStore.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { BookTextReader } from './BookTextReader.tsx';
import { ShownImage } from './ShownImage.tsx';
import { playerText } from '../i18n.ts';
import '../../../src/app/online/tableLog/styles/table-log.scss';

export interface TableLogProps {
  readonly state: LogState;
  readonly entries: readonly LogEntry[];
  readonly people: readonly TablePerson[];
  readonly refusal: { readonly reason: ChatRefusal; readonly revision: number } | null;
  readonly self: string | null;
  readonly scene: string | null;
  readonly tokens: PlayerTokens | null;
  readonly mine: readonly string[];
  readonly gmOnline: boolean;
  readonly busy: boolean;
  readonly assets: AssetDownloads;
  readonly send: (message: PlayerMessage) => boolean;
  readonly onClose: () => void;
  readonly onSendRejected: () => void;
}

const NO_TOKENS: readonly SharedToken[] = [];
function tokenPortrait(token: SharedToken, urls: ReadonlyMap<string, string>): Portrait | null {
  if (!token.art) return null;
  const src = urls.get(token.art.hash);
  return src === undefined ? null : { src, ...(token.ring ? { showRing: true, ringColor: token.ring.colour } : {}) };
}

function imageRefs(entries: readonly LogEntry[], tokens: readonly SharedToken[]): readonly { readonly hash: string; readonly asset: AssetRef }[] {
  const refs = new Map<string, AssetRef>();
  for (const entry of entries) {
    if (entry.kind === 'image') refs.set(entry.image.hash, entry.image);
    if ((entry.kind === 'chat' || entry.kind === 'roll' || entry.kind === 'secret') && entry.speaker?.art) refs.set(entry.speaker.art.hash, entry.speaker.art);
  }
  for (const token of tokens) if (token.art) refs.set(token.art.hash, token.art);
  return [...refs].map(([hash, asset]) => ({ hash, asset }));
}

export function TableLog({ state, entries, people, refusal, self, scene, tokens, mine, gmOnline, busy, assets, send, onClose, onSendRejected }: TableLogProps): ReactElement {
  const [assetUrls, setAssetUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [openImage, setOpenImage] = useState<ImageEntry | null>(null);
  const [openFound, setOpenFound] = useState<FoundEntry | null>(null);
  const visibleTokens = tokens?.tokens ?? NO_TOKENS;
  const refs = useMemo(() => imageRefs(entries, visibleTokens), [entries, visibleTokens]);
  useEffect(() => state.replace(entries), [entries, state]);
  useEffect(() => state.setPeople(people), [people, state]);
  useEffect(() => {
    if (refusal === null) return;
    state.receive({ t: 'chat-refused', reason: refusal.reason });
  }, [refusal?.revision, refusal?.reason, state]);
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    const acquired: string[] = [];
    void Promise.all(refs.map(async ({ hash, asset }) => {
      const blob = await assets.request(asset);
      if (!alive) { assets.release(hash); return [hash, ''] as const; }
      acquired.push(hash);
      const url = URL.createObjectURL(blob);
      created.push(url);
      return [hash, url] as const;
    })).then((pairs) => {
      if (alive) setAssetUrls(new Map(pairs));
    }).catch(() => {
      if (alive) setAssetUrls(new Map());
    });
    return () => {
      alive = false;
      for (const url of created) URL.revokeObjectURL(url);
      for (const hash of acquired) assets.release(hash);
    };
  }, [assets, refs]);
  const speakers = useMemo<readonly SpeakerOption[]>(() => [
    { key: 'self', name: playerText('you'), kind: 'self', portrait: null },
    ...visibleTokens.filter((token) => mine.includes(token.id)).map((token) => ({ key: token.id, name: token.name ?? playerText('unknownSpeaker'), kind: 'token' as const, portrait: tokenPortrait(token, assetUrls) })),
  ], [assetUrls, mine, visibleTokens]);
  const sendAction = useCallback((message: PlayerMessage): void => {
    if (!send(message)) onSendRejected();
  }, [onSendRejected, send]);
  const actions = useMemo<LogActions>(() => ({
    say(draft) {
      sendAction({ t: 'chat', ...draft });
    },
    roll(draft) {
      if (scene === null) {
        onSendRejected();
        return;
      }
      sendAction({ t: 'roll', scene, formula: draft.formula, token: draft.speaker ?? null, mode: draft.mode, ...(draft.flavor ? { flavor: draft.flavor } : {}), ...(draft.request ? { request: draft.request } : {}) });
    },
    edit(id, text) { sendAction({ t: 'chat-edit', id, text }); },
    remove(id) { sendAction({ t: 'chat-delete', id }); },
    react(id, emoji, on) { sendAction({ t: 'react', id, emoji, on }); },
  }), [onSendRejected, scene, sendAction]);
  const rollFace = (entry: RollEntry): RollFace | null => {
    if (entry.speaker) return { name: entry.speaker.name, portrait: speakerPortrait(entry.speaker) };
    if (entry.token === null) return null;
    const token = visibleTokens.find((candidate) => candidate.id === entry.token);
    if (!token) return null;
    return { name: token.name, portrait: tokenPortrait(token, assetUrls) };
  };
  const speakerPortrait = (speaker: LogSpeaker): Portrait | null => {
    if (speaker.art !== null) {
      const src = assetUrls.get(speaker.art.hash);
      if (src) return { src, showRing: speaker.ring !== null, ...(speaker.ring === null ? {} : { ringColor: speaker.ring }) };
    }
    const token = visibleTokens.find((candidate) => candidate.id === speaker.token);
    return token ? tokenPortrait(token, assetUrls) : null;
  };
  const view = <TableLogPanel
    state={state}
    actions={actions}
    self={self}
    moderator={false}
    canSend={gmOnline && !busy}
    offlineText={playerText(gmOnline ? 'busy' : 'gmOffline')}
    rollFace={rollFace}
    speakers={speakers}
    speakerPortrait={speakerPortrait}
    imageSrc={(entry: ImageEntry) => assetUrls.get(entry.image.hash) ?? null}
    openImage={setOpenImage}
    openFound={setOpenFound}
    variant="embedded"
    onClose={onClose}
  />;
  return <>
    {view}
    {openImage && <ShownImage message={{ t: 'shown-image', shown: { id: openImage.id, image: openImage.image, width: openImage.width, height: openImage.height } }} assets={assets} onClose={() => setOpenImage(null)} />}
    {openFound && <div className="atlas-player__found-reader" role="dialog" aria-modal="true"><CloseButton onClick={() => setOpenFound(null)} aria-label={playerText('close')} /><BookTextReader title={openFound.title} opening={openFound.body} text={openFound.text} images={openFound.images} assets={assets} /></div>}
  </>;
}
