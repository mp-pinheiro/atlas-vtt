import { Skeleton, SkeletonGroup } from '../../../src/app/packages/components/primitives/Skeleton.tsx';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { PlayerBook, PlayerBookMessage, BookNote, BookNoteDraft, BookQuest } from '../../../src/app/online/protocol/book.ts';
import type { SheetResource } from '../../../src/app/online/protocol/bookCharacter.ts';
import type { SharedSheet } from '../../../src/app/online/protocol/sheet.ts';
import type { RollMode } from '../../../src/app/online/protocol/chat.ts';
import { DEFAULT_BOOK_SLOTS, DEFAULT_SLOTS, DEFAULT_SLOT_NAMES, shownSlots, type BookSlots } from '../../../src/app/online/protocol/bookSlots.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { playerText } from '../i18n.ts';
import { BookTextReader } from './BookTextReader.tsx';
import { SafeMarkdown } from './SafeMarkdown.tsx';
import { WorldMap } from './book/WorldMap.tsx';

type BookTab = 'character' | 'items' | 'notes' | 'pins' | 'purse' | 'quests' | 'world-map';

export interface BookPanelProps {
  readonly book: PlayerBook | null;
  readonly assets: AssetDownloads;
  readonly send: (message: PlayerBookMessage | { readonly t: 'sheet-roll'; readonly sheet: string; readonly index: number; readonly mode: RollMode }) => boolean;
  readonly renderSheet?: (sheet: SharedSheet, onRoll: (index: number, mode: RollMode) => boolean) => ReactNode;
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function BookResource({ resource, send }: { readonly resource: SheetResource; readonly send: BookPanelProps['send'] }): ReactElement {
  const [current, setCurrent] = useState(resource.current);
  useEffect(() => setCurrent(resource.current), [resource]);
  const commit = (): void => {
    if (!resource.editable || resource.key === null || current === resource.current) return;
    if (!Number.isFinite(current)) { setCurrent(resource.current); return; }
    if (!send({ t: 'book-resource', key: resource.key, current: Math.max(0, Math.min(resource.max, current)) })) setCurrent(resource.current);
  };
  return <label className="atlas-player__item"><span>{resource.name}</span><span>{resource.direction === 'static' ? resource.max : <input aria-label={resource.name} type="number" min={0} max={resource.max} value={current} disabled={!resource.editable} onChange={(event) => setCurrent(Number(event.currentTarget.value))} onBlur={commit} />}{resource.direction !== 'static' && ` / ${resource.max}`}</span></label>;
}

function Character({ book, send, renderSheet }: { readonly book: PlayerBook; readonly send: BookPanelProps['send']; readonly renderSheet?: BookPanelProps['renderSheet'] }): ReactElement {
  const character = book.character;
  if (character === null) return <p>{playerText('noCharacter')}</p>;
  const sheet = character.statblock;
  const onRoll = (index: number, mode: RollMode): boolean => sheet != null && send({ t: 'sheet-roll', sheet: sheet.revision, index, mode });
  return <section className="atlas-player__list">
    <h2>{character.name}</h2>
    {character.resources.map((resource) => <BookResource key={resource.key ?? resource.name} resource={resource} send={send} />)}
    {sheet && renderSheet ? renderSheet(sheet, onRoll) : sheet ? <p>{playerText('sheetUnavailable')}</p> : null}
  </section>;
}

function Items({ book, send }: { readonly book: PlayerBook; readonly send: BookPanelProps['send'] }): ReactElement {
  const slots = book.slots ?? DEFAULT_BOOK_SLOTS;
  const slotList = shownSlots(slots);
  return <section className="atlas-player__list">
    {book.items.map((item) => <article className="atlas-player__item" key={item.id}>
      <h3>{item.name}</h3>
      {item.type && <p>{item.type}</p>}{item.description && <SafeMarkdown text={item.description} />}
      {item.properties.map((property) => <p key={property.label}><strong>{property.label}</strong>: {property.value}</p>)}
      <label>{playerText('equip')}<select className="atlas-player__field" value={book.equipped.find((entry) => entry.item === item.id)?.slot ?? ''} onChange={(event) => send({ t: 'book-equip', item: item.id, slot: event.currentTarget.value || null })}><option value="">{playerText('unequipped')}</option>{slotList.map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}</select></label>
    </article>)}
    {book.items.length === 0 && <p>{playerText('noItems')}</p>}
  </section>;
}

function Notes({ book, send, quest }: { readonly book: PlayerBook; readonly send: BookPanelProps['send']; readonly quest?: BookQuest }): ReactElement {
  const [active, setActive] = useState<BookNote | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const notes = book.notes.filter((note) => (note.quest ?? '') === (quest?.id ?? ''));
  const start = (note?: BookNote): void => { setActive(note ?? null); setTitle(note?.title ?? ''); setBody(note?.body ?? ''); setEditing(true); };
  const close = (): void => { setEditing(false); setActive(null); setTitle(''); setBody(''); };
  const save = (): void => {
    const note: BookNoteDraft = { id: active?.id ?? randomId(), title, body, ...(quest ? { quest: quest.id } : {}) };
    if (send({ t: 'book-note', note })) close();
  };
  return <section className="atlas-player__list">
    {notes.map((note) => <article className="atlas-player__item" key={note.id}><h3>{note.title || playerText('untitled')}</h3><SafeMarkdown text={note.body} /><div className="atlas-player__row"><button type="button" onClick={() => start(note)}>{playerText('edit')}</button><button type="button" onClick={() => send({ t: 'book-note-delete', id: note.id })}>{playerText('delete')}</button></div></article>)}
    {editing ? <form className="atlas-player__list" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label>{playerText('titleField')}<input className="atlas-player__field" maxLength={80} value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label>{playerText('bodyField')}<textarea className="atlas-player__field" maxLength={2000} value={body} onChange={(event) => setBody(event.currentTarget.value)} /></label>
      <button type="submit">{playerText('save')}</button><button type="button" onClick={close}>{playerText('cancel')}</button>
    </form> : <button type="button" onClick={() => start()}>{playerText('newNote')}</button>}
  </section>;
}

function Pins({ book, send }: { readonly book: PlayerBook; readonly send: BookPanelProps['send'] }): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const selected = book.pins.find((pin) => pin.id === editing);
  return <section className="atlas-player__list">{book.pins.map((pin) => <article className="atlas-player__item" key={pin.id}><h3>{pin.title}</h3><SafeMarkdown text={pin.body} /><p>{pin.map ? playerText('nestedMap') : playerText('worldMap')}</p><div className="atlas-player__row"><button type="button" onClick={() => { setEditing(pin.id); setTitle(pin.title); setBody(pin.body); }}>{playerText('edit')}</button><button type="button" onClick={() => send({ t: 'book-pin-delete', id: pin.id })}>{playerText('delete')}</button></div></article>)}{book.pins.length === 0 && <p>{playerText('noPins')}</p>}{selected && <form className="atlas-player__list" onSubmit={(event) => { event.preventDefault(); if (send({ t: 'book-pin', pin: { ...selected, title, body } })) setEditing(null); }}><label>{playerText('titleField')}<input value={title} maxLength={80} onChange={(event) => setTitle(event.currentTarget.value)} /></label><label>{playerText('bodyField')}<textarea value={body} maxLength={2000} onChange={(event) => setBody(event.currentTarget.value)} /></label><button type="submit">{playerText('save')}</button><button type="button" onClick={() => setEditing(null)}>{playerText('cancel')}</button></form>}</section>;
}

function Purse({ book, send }: { readonly book: PlayerBook; readonly send: BookPanelProps['send'] }): ReactElement {
  const [rows, setRows] = useState(book.purse);
  const [currency, setCurrency] = useState('');
  useEffect(() => setRows(book.purse), [book.purse]);
  const update = (index: number, amount: number): void => setRows((current) => current.map((row, i) => i === index ? { ...row, amount } : row));
  return <section className="atlas-player__list">{rows.map((row, index) => <div className="atlas-player__row" key={row.name}><label>{row.name}<input className="atlas-player__field" type="number" min={0} max={1_000_000_000} step="any" value={row.amount} onChange={(event) => update(index, Number(event.currentTarget.value))} /></label><button type="button" aria-label={`${playerText('delete')} ${row.name}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>{playerText('delete')}</button></div>)}<label>{playerText('currency')}<input className="atlas-player__field" value={currency} maxLength={24} onChange={(event) => setCurrency(event.currentTarget.value)} /></label><button type="button" disabled={currency.trim() === '' || rows.length >= 6 || rows.some((row) => row.name === currency.trim())} onClick={() => { setRows((current) => [...current, { name: currency.trim(), amount: 0 }]); setCurrency(''); }}>{playerText('add')}</button><button type="button" onClick={() => { if (!send({ t: 'book-purse', purse: rows })) setRows(book.purse); }}>{playerText('save')}</button></section>;
}

function Quests({ book, assets, send }: { readonly book: PlayerBook; readonly assets: AssetDownloads; readonly send: BookPanelProps['send'] }): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const quest = book.quests.find((entry) => entry.id === selected) ?? null;
  if (quest) return <section className="atlas-player__list"><button type="button" onClick={() => setSelected(null)}>{playerText('back')}</button><BookTextReader title={quest.title} opening={quest.body} text={quest.text} images={quest.images} assets={assets} /><p>{playerText('questStatus')}: {quest.state}</p><p>{playerText('rewards')}: {quest.rewards.join(', ')}</p><Notes book={book} send={send} quest={quest} /></section>;
  return <section className="atlas-player__list">{book.quests.map((entry) => <button type="button" className="atlas-player__item" key={entry.id} onClick={() => setSelected(entry.id)}><strong>{entry.title}</strong><span>{entry.state}</span></button>)}{book.quests.length === 0 && <p>{playerText('noQuests')}</p>}</section>;
}

function Slots({ book, send }: { readonly book: PlayerBook; readonly send: BookPanelProps['send'] }): ReactElement {
  const [slots, setSlots] = useState<BookSlots>(book.slots ?? DEFAULT_BOOK_SLOTS);
  useEffect(() => setSlots(book.slots ?? DEFAULT_BOOK_SLOTS), [book.slots]);
  const [newSlot, setNewSlot] = useState('');
  const add = (): void => {
    if (newSlot.trim() === '' || slots.own.length >= 12) return;
    const updated = { ...slots, own: [...slots.own, { id: randomId(), name: newSlot.trim() }] };
    if (send({ t: 'book-slots', slots: updated })) { setSlots(updated); setNewSlot(''); }
  };
  const toggleHidden = (id: (typeof DEFAULT_SLOTS)[number]): void => {
    const hidden = slots.hidden.includes(id) ? slots.hidden.filter((slot) => slot !== id) : [...slots.hidden, id];
    const updated = { ...slots, hidden };
    if (send({ t: 'book-slots', slots: updated })) setSlots(updated);
  };
  return <section className="atlas-player__list"><h3>{playerText('slots')}</h3>{DEFAULT_SLOTS.map((slot) => <label key={slot}><input type="checkbox" checked={!slots.hidden.includes(slot)} onChange={() => toggleHidden(slot)} />{DEFAULT_SLOT_NAMES[slot]}</label>)}{slots.own.map((slot) => <div className="atlas-player__row" key={slot.id}><span>{slot.name}</span><button type="button" aria-label={`${playerText('delete')} ${slot.name}`} onClick={() => { const updated = { ...slots, own: slots.own.filter((entry) => entry.id !== slot.id) }; if (send({ t: 'book-slots', slots: updated })) setSlots(updated); }}>{playerText('delete')}</button></div>)}<label>{playerText('newSlot')}<input className="atlas-player__field" maxLength={24} value={newSlot} onChange={(event) => setNewSlot(event.currentTarget.value)} /></label><button type="button" onClick={add} disabled={slots.own.length >= 12}>{playerText('add')}</button></section>;
}

const BOOK_TAB_LABELS: Readonly<Record<BookTab, Parameters<typeof playerText>[0]>> = {
  character: 'bookCharacter',
  items: 'bookItems',
  notes: 'bookNotes',
  pins: 'bookPins',
  purse: 'bookPurse',
  quests: 'bookQuests',
  'world-map': 'worldMap',
};
export function BookPanel({ book, assets, send, renderSheet }: BookPanelProps): ReactElement {
  const [tab, setTab] = useState<BookTab>('character');
  const [worldOpen, setWorldOpen] = useState(false);
  if (book === null) return <SkeletonGroup label={playerText('loading')} className="atlas-player__surface"><Skeleton shape="text" width="60%" /><Skeleton shape="text" width="90%" /><Skeleton shape="block" style={{ height: 160 }} /></SkeletonGroup>;
  const content = (() => {
    switch (tab) {
      case 'character': return <Character book={book} send={send} renderSheet={renderSheet} />;
      case 'items': return <><Items book={book} send={send} /><Slots book={book} send={send} /></>;
      case 'notes': return <Notes book={book} send={send} />;
      case 'pins': return <Pins book={book} send={send} />;
      case 'purse': return <Purse book={book} send={send} />;
      case 'quests': return <Quests book={book} assets={assets} send={send} />;
      case 'world-map': return <WorldMap worldMap={worldOpen ? book.worldMap : null} pins={book.pins} assets={assets} send={send} />;
    }
  })();
  return <section className="atlas-player__surface" aria-label={playerText('tabBook')}>
    <nav className="atlas-player__tabs" aria-label={playerText('tabBook')}>
      {(['character', 'items', 'notes', 'pins', 'purse', 'quests', 'world-map'] as const).map((page) => <button type="button" aria-pressed={tab === page} key={page} onClick={() => setTab(page)}>{playerText(BOOK_TAB_LABELS[page])}</button>)}
    </nav>
    {tab === 'world-map' && !worldOpen && <button type="button" onClick={() => setWorldOpen(true)}>{playerText('openWorldMap')}</button>}
    {content}
  </section>;
}
