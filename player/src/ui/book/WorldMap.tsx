import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react';
import { Button } from '../../../../src/app/packages/components/primitives/button.tsx';
import type { AssetDownloads } from '../../state/interfaces.ts';
import type { BookPin, BookWorldMap, PlayerBookMessage } from '../../../../src/app/online/protocol/book.ts';
import { playerText } from '../../i18n.ts';

const ROOT_MAP = '__atlas-root__';

export interface WorldMapProps {
  readonly worldMap: BookWorldMap | null;
  readonly pins: readonly BookPin[];
  readonly assets: AssetDownloads;
  readonly send: (message: PlayerBookMessage) => boolean;
  readonly disabled?: boolean;
}

export function WorldMap({ worldMap, pins, assets, send, disabled = false }: WorldMapProps): ReactElement | null {
  const [selected, setSelected] = useState(ROOT_MAP);
  const [back, setBack] = useState<readonly string[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const maps = useMemo(() => worldMap?.maps ?? [], [worldMap]);
  const current = useMemo(() => selected === ROOT_MAP ? null : maps.find((map) => map.id === selected) ?? null, [maps, selected]);
  const image = current ?? worldMap;
  useEffect(() => {
    if (worldMap === null) {
      setSelected(ROOT_MAP);
      setBack([]);
      setDraft(null);
      return;
    }
    const valid = new Set(maps.map((map) => map.id));
    setBack((stack) => stack.filter((id) => id === ROOT_MAP || valid.has(id)));
    if (selected !== ROOT_MAP && !valid.has(selected)) setSelected(ROOT_MAP);
  }, [maps, selected, worldMap]);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    let acquired = false;
    setImageUrl(null);
    setNotice(null);
    if (!image) return () => { alive = false; };
    const maxSide = Math.min(16384, Math.max(256, Math.ceil(Math.max(window.innerWidth, window.innerHeight) * window.devicePixelRatio * 2)));
    void assets.request(image.image, maxSide).then((blob) => {
      if (!alive) { assets.release(image.image.hash, maxSide); return; }
      acquired = true;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    }).catch(() => {
      if (alive) setNotice(playerText('imageUnavailable'));
    });
    return () => {
      alive = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
      if (acquired) assets.release(image.image.hash, maxSide);
    };
  }, [assets, image]);
  if (worldMap === null) return null;
  const navigate = (mapId: string): void => {
    const target = mapId === worldMap.id ? ROOT_MAP : mapId;
    if (target === selected || (target !== ROOT_MAP && !maps.some((map) => map.id === target))) return;
    setBack((stack) => [...stack, selected]);
    setSelected(target);
    setDraft(null);
  };
  const goBack = (): void => {
    const prior = back.at(-1);
    if (prior === undefined) return;
    setBack((stack) => stack.slice(0, -1));
    setSelected(prior);
    setDraft(null);
  };
  const startDraft = (x: number, y: number): void => {
    if (disabled || !imageUrl || !image) return;
    setDraft({ x, y });
    setTitle('');
    setBody('');
  };
  const placePin = (event: MouseEvent<HTMLDivElement>): void => {
    if (disabled || !imageUrl || !image) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    startDraft(x, y);
  };
  const savePin = (): void => {
    if (disabled || draft === null) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const pin: BookPin = { id, ...(selected === ROOT_MAP ? {} : { map: selected }), x: draft.x, y: draft.y, kind: 'note', title, body };
    if (send({ t: 'book-pin', pin })) setDraft(null);
    else setNotice(playerText('busy'));
  };
  const currentPins = pins.filter((pin) => selected === ROOT_MAP ? pin.map === undefined || pin.map === worldMap.id : pin.map === selected);
  const entrances = current === null ? worldMap.entrances ?? [] : current.entrances;
  return <section className="atlas-player__section atlas-player__world-map-view" aria-label={playerText('worldMap')}>
    <header className="atlas-player__row atlas-player__world-map-heading">
      <Button type="button" size="sm" variant="ghost" onClick={goBack} disabled={back.length === 0}>{playerText('back')}</Button>
      <strong>{current?.title ?? playerText('worldMap')}</strong>
      <Button type="button" size="sm" variant="outline" disabled={disabled || !imageUrl} onClick={() => startDraft(0.5, 0.5)}>{playerText('pin')}</Button>
    </header>
    {notice && <p className="atlas-player__notice" role="status">{notice}</p>}
    {!imageUrl || !image ? <p className="atlas-player__muted" role="status">{playerText('loading')}</p> : <div className={`atlas-player__world-map${disabled ? ' atlas-player__world-map--read-only' : ''}`} role="group" aria-label={current?.title ?? playerText('worldMap')} onClick={placePin} style={{ aspectRatio: `${image.width} / ${image.height}`, backgroundImage: `url("${imageUrl}")` }}>
      {entrances.map((entrance, index) => <Button key={`entrance:${index}`} type="button" size="sm" variant="secondary" className="atlas-player__map-marker" style={{ left: `${entrance.x * 100}%`, top: `${entrance.y * 100}%` }} onClick={(event) => { event.stopPropagation(); navigate(entrance.to); }} aria-label={entrance.title}>{entrance.title}</Button>)}
      {currentPins.map((pin) => <span key={pin.id} className="atlas-player__map-marker" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}>
        <span>{pin.title}</span>
        <Button type="button" size="icon" variant="ghost" aria-label={`${playerText('delete')} ${pin.title}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); if (!disabled && !send({ t: 'book-pin-delete', id: pin.id })) setNotice(playerText('busy')); }}>×</Button>
      </span>)}
      {draft && <span className="atlas-player__map-marker atlas-player__map-marker--draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>+</span>}
    </div>}
    {draft && <form className="atlas-player__section atlas-player__book-editor" onSubmit={(event) => { event.preventDefault(); savePin(); }}>
      <label>{playerText('titleField')}<input className="atlas-player__field" maxLength={80} value={title} disabled={disabled} onChange={(event) => setTitle(event.currentTarget.value)} required /></label>
      <label>{playerText('bodyField')}<textarea className="atlas-player__field atlas-player__book-textarea" maxLength={2000} value={body} disabled={disabled} onChange={(event) => setBody(event.currentTarget.value)} /></label>
      <div className="atlas-player__row">
        <Button type="submit" size="sm" disabled={disabled}>{playerText('save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>{playerText('cancel')}</Button>
      </div>
    </form>}
  </section>;
}
