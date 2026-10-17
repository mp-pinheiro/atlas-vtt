import { Skeleton, SkeletonGroup } from '../../../../src/app/packages/components/primitives/Skeleton.tsx';
import { Button } from '../../../../src/app/packages/components/primitives/button.tsx';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { PlayerBook, PlayerBookMessage, BookNote, BookNoteDraft, BookQuest } from '../../../../src/app/online/protocol/book.ts';
import type { SheetResource } from '../../../../src/app/online/protocol/bookCharacter.ts';
import type { SharedSheet } from '../../../../src/app/online/protocol/sheet.ts';
import type { RollMode } from '../../../../src/app/online/protocol/chat.ts';
import { DEFAULT_BOOK_SLOTS, DEFAULT_SLOTS, DEFAULT_SLOT_NAMES, shownSlots, type BookSlots } from '../../../../src/app/online/protocol/bookSlots.ts';
import type { AssetDownloads } from '../../state/interfaces.ts';
import { playerText } from '../../i18n.ts';
import { BookTextReader } from '../BookTextReader.tsx';
import { SafeMarkdown } from '../SafeMarkdown.tsx';

export type BookSend = (message: PlayerBookMessage | { readonly t: 'sheet-roll'; readonly sheet: string; readonly index: number; readonly mode: RollMode }) => boolean;
export type BookSheetRenderer = (sheet: SharedSheet, onRoll: (index: number, mode: RollMode) => boolean) => ReactNode;

export function BookLoading(): ReactElement {
  return <SkeletonGroup label={playerText('loading')} className="atlas-player__book-skeleton">
    <Skeleton shape="text" width="60%" />
    <Skeleton shape="text" width="90%" />
    <Skeleton shape="block" style={{ height: 160 }} />
  </SkeletonGroup>;
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function Character({ book, send, renderSheet, characterControls, disabled }: { readonly book: PlayerBook | null; readonly send: BookSend; readonly renderSheet?: BookSheetRenderer; readonly characterControls?: ReactNode; readonly disabled: boolean }): ReactElement {
  const character = book?.character ?? null;
  const sheet = character?.statblock ?? null;
  const onRoll = (index: number, mode: RollMode): boolean => !disabled && sheet !== null && send({ t: 'sheet-roll', sheet: sheet.revision, index, mode });
  return <section className="atlas-player__section atlas-player__book-character">
    {book === null ? <BookLoading /> : character === null ? <p className="atlas-player__empty">{playerText('noCharacter')}</p> : <>
      <h2 className="atlas-player__book-character-name">{character.name}</h2>
      <div className="atlas-player__list atlas-player__book-resources">
        {character.resources.map((resource) => <BookResource key={resource.key ?? resource.name} resource={resource} send={send} disabled={disabled} />)}
      </div>
    </>}
    {characterControls !== undefined && <fieldset className="atlas-player__book-controls" disabled={disabled}>
      <legend className="sr-only">{playerText('bookCharacter')}</legend>
      {characterControls}
    </fieldset>}
    {sheet !== null && renderSheet !== undefined && <fieldset className="atlas-player__book-sheet" disabled={disabled}>
      <legend className="sr-only">{character?.name}</legend>
      {renderSheet(sheet, onRoll)}
    </fieldset>}
    {sheet !== null && renderSheet === undefined && <p className="atlas-player__muted">{playerText('sheetUnavailable')}</p>}
  </section>;
}

function BookResource({ resource, send, disabled }: { readonly resource: SheetResource; readonly send: BookSend; readonly disabled: boolean }): ReactElement {
  const [current, setCurrent] = useState(resource.current);
  useEffect(() => setCurrent(resource.current), [resource]);
  const editable = resource.editable && resource.key !== null && !disabled;
  const commit = (): void => {
    if (!editable || resource.key === null || current === resource.current) return;
    if (!Number.isFinite(current)) { setCurrent(resource.current); return; }
    if (!send({ t: 'book-resource', key: resource.key, current: Math.max(0, Math.min(resource.max, current)) })) setCurrent(resource.current);
  };
  return <label className="atlas-player__row atlas-player__book-resource">
    <span>{resource.name}</span>
    <span className="atlas-player__book-resource-value">
      {resource.direction === 'static' ? resource.max : <input className="atlas-player__field" aria-label={resource.name} type="number" min={0} max={resource.max} value={current} disabled={!editable} onChange={(event) => setCurrent(Number(event.currentTarget.value))} onBlur={commit} />}
      {resource.direction !== 'static' && ` / ${resource.max}`}
    </span>
  </label>;
}

export function Items({ book, send, disabled }: { readonly book: PlayerBook; readonly send: BookSend; readonly disabled: boolean }): ReactElement {
  const slots = book.slots ?? DEFAULT_BOOK_SLOTS;
  const slotList = shownSlots(slots);
  return <section className="atlas-player__section atlas-player__book-items">
    {book.items.map((item) => <article className="atlas-player__item atlas-player__book-item" key={item.id}>
      <h3>{item.name}</h3>
      {item.type && <p className="atlas-player__muted">{item.type}</p>}
      {item.description && <SafeMarkdown text={item.description} />}
      {item.properties.map((property) => <p key={property.label}><strong>{property.label}</strong>: {property.value}</p>)}
      <label className="atlas-player__book-equip">{playerText('equip')}
        <select className="atlas-player__field" value={book.equipped.find((entry) => entry.item === item.id)?.slot ?? ''} disabled={disabled} onChange={(event) => { if (!disabled) send({ t: 'book-equip', item: item.id, slot: event.currentTarget.value || null }); }}>
          <option value="">{playerText('unequipped')}</option>
          {slotList.map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
        </select>
      </label>
    </article>)}
    {book.items.length === 0 && <p className="atlas-player__empty">{playerText('noItems')}</p>}
  </section>;
}

export function Notes({ book, send, quest, disabled }: { readonly book: PlayerBook; readonly send: BookSend; readonly quest?: BookQuest; readonly disabled: boolean }): ReactElement {
  const [active, setActive] = useState<BookNote | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const notes = book.notes.filter((note) => (note.quest ?? '') === (quest?.id ?? ''));
  const start = (note?: BookNote): void => { setActive(note ?? null); setTitle(note?.title ?? ''); setBody(note?.body ?? ''); setEditing(true); };
  const close = (): void => { setEditing(false); setActive(null); setTitle(''); setBody(''); };
  const save = (): void => {
    if (disabled) return;
    const note: BookNoteDraft = { id: active?.id ?? randomId(), title, body, ...(quest ? { quest: quest.id } : {}) };
    if (send({ t: 'book-note', note })) close();
  };
  return <section className="atlas-player__section atlas-player__book-notes">
    {notes.map((note) => <article className="atlas-player__item atlas-player__book-note" key={note.id}>
      <h3>{note.title || playerText('untitled')}</h3>
      <SafeMarkdown text={note.body} />
      <div className="atlas-player__row">
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => start(note)}>{playerText('edit')}</Button>
        <Button type="button" size="sm" variant="destructive" disabled={disabled} onClick={() => { if (!disabled) send({ t: 'book-note-delete', id: note.id }); }}>{playerText('delete')}</Button>
      </div>
    </article>)}
    {editing ? <form className="atlas-player__section atlas-player__book-editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label>{playerText('titleField')}<input className="atlas-player__field" maxLength={80} value={title} disabled={disabled} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label>{playerText('bodyField')}<textarea className="atlas-player__field atlas-player__book-textarea" maxLength={2000} value={body} disabled={disabled} onChange={(event) => setBody(event.currentTarget.value)} /></label>
      <div className="atlas-player__row">
        <Button type="submit" size="sm" disabled={disabled}>{playerText('save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={close}>{playerText('cancel')}</Button>
      </div>
    </form> : <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => start()}>{playerText('newNote')}</Button>}
  </section>;
}

export function Pins({ book, send, disabled }: { readonly book: PlayerBook; readonly send: BookSend; readonly disabled: boolean }): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const selected = book.pins.find((pin) => pin.id === editing);
  return <section className="atlas-player__section atlas-player__book-pins">
    {book.pins.map((pin) => <article className="atlas-player__item atlas-player__book-pin" key={pin.id}>
      <h3>{pin.title}</h3>
      <SafeMarkdown text={pin.body} />
      <p className="atlas-player__muted">{pin.map ? playerText('nestedMap') : playerText('worldMap')}</p>
      <div className="atlas-player__row">
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { setEditing(pin.id); setTitle(pin.title); setBody(pin.body); }}>{playerText('edit')}</Button>
        <Button type="button" size="sm" variant="destructive" disabled={disabled} onClick={() => { if (!disabled) send({ t: 'book-pin-delete', id: pin.id }); }}>{playerText('delete')}</Button>
      </div>
    </article>)}
    {book.pins.length === 0 && <p className="atlas-player__empty">{playerText('noPins')}</p>}
    {selected && <form className="atlas-player__section atlas-player__book-editor" onSubmit={(event) => { event.preventDefault(); if (!disabled && send({ t: 'book-pin', pin: { ...selected, title, body } })) setEditing(null); }}>
      <label>{playerText('titleField')}<input className="atlas-player__field" value={title} maxLength={80} disabled={disabled} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label>{playerText('bodyField')}<textarea className="atlas-player__field atlas-player__book-textarea" value={body} maxLength={2000} disabled={disabled} onChange={(event) => setBody(event.currentTarget.value)} /></label>
      <div className="atlas-player__row">
        <Button type="submit" size="sm" disabled={disabled}>{playerText('save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{playerText('cancel')}</Button>
      </div>
    </form>}
  </section>;
}

export function Purse({ book, send, disabled }: { readonly book: PlayerBook; readonly send: BookSend; readonly disabled: boolean }): ReactElement {
  const [rows, setRows] = useState(book.purse);
  const [currency, setCurrency] = useState('');
  useEffect(() => setRows(book.purse), [book.purse]);
  return <section className="atlas-player__section atlas-player__book-purse">
    {rows.map((row, index) => <div className="atlas-player__row atlas-player__book-purse-row" key={row.name}>
      <label>{row.name}
        <input className="atlas-player__field" type="number" min={0} max={1_000_000_000} step="any" value={row.amount} disabled={disabled} onChange={(event) => {
          const amount = Number(event.currentTarget.value);
          setRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, amount } : entry));
        }} />
      </label>
      <Button type="button" size="sm" variant="destructive" aria-label={`${playerText('delete')} ${row.name}`} disabled={disabled} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>{playerText('delete')}</Button>
    </div>)}
    <label>{playerText('currency')}<input className="atlas-player__field" value={currency} maxLength={24} disabled={disabled} onChange={(event) => setCurrency(event.currentTarget.value)} /></label>
    <div className="atlas-player__row">
      <Button type="button" size="sm" variant="outline" disabled={disabled || currency.trim() === '' || rows.length >= 6 || rows.some((row) => row.name === currency.trim())} onClick={() => { setRows((current) => [...current, { name: currency.trim(), amount: 0 }]); setCurrency(''); }}>{playerText('add')}</Button>
      <Button type="button" size="sm" disabled={disabled} onClick={() => { if (!send({ t: 'book-purse', purse: rows })) setRows(book.purse); }}>{playerText('save')}</Button>
    </div>
  </section>;
}

export function Quests({ book, assets, send, disabled }: { readonly book: PlayerBook; readonly assets: AssetDownloads; readonly send: BookSend; readonly disabled: boolean }): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const quest = book.quests.find((entry) => entry.id === selected) ?? null;
  if (quest) return <section className="atlas-player__section atlas-player__book-quest">
    <div className="atlas-player__row atlas-player__book-quest-heading">
      <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>{playerText('back')}</Button>
      <h2>{quest.title}</h2>
    </div>
    <BookTextReader title={quest.title} opening={quest.body} text={quest.text} images={quest.images} assets={assets} />
    <dl className="atlas-player__book-quest-details">
      <div><dt>{playerText('questStatus')}</dt><dd>{quest.state}</dd></div>
      <div><dt>{playerText('rewards')}</dt><dd>{quest.rewards.join(', ')}</dd></div>
    </dl>
    <h3>{playerText('bookNotes')}</h3>
    <Notes book={book} send={send} quest={quest} disabled={disabled} />
  </section>;
  return <section className="atlas-player__section atlas-player__book-quests">
    {book.quests.map((entry) => <Button type="button" variant="ghost" className="atlas-player__item atlas-player__book-quest-choice" key={entry.id} onClick={() => setSelected(entry.id)}>
      <strong>{entry.title}</strong><span className="atlas-player__muted">{entry.state}</span>
    </Button>)}
    {book.quests.length === 0 && <p className="atlas-player__empty">{playerText('noQuests')}</p>}
  </section>;
}

export function Slots({ book, send, disabled }: { readonly book: PlayerBook; readonly send: BookSend; readonly disabled: boolean }): ReactElement {
  const [slots, setSlots] = useState<BookSlots>(book.slots ?? DEFAULT_BOOK_SLOTS);
  useEffect(() => setSlots(book.slots ?? DEFAULT_BOOK_SLOTS), [book.slots]);
  const [newSlot, setNewSlot] = useState('');
  const add = (): void => {
    if (disabled || newSlot.trim() === '' || slots.own.length >= 12) return;
    const updated = { ...slots, own: [...slots.own, { id: randomId(), name: newSlot.trim() }] };
    if (send({ t: 'book-slots', slots: updated })) { setSlots(updated); setNewSlot(''); }
  };
  const toggleHidden = (id: (typeof DEFAULT_SLOTS)[number]): void => {
    if (disabled) return;
    const hidden = slots.hidden.includes(id) ? slots.hidden.filter((slot) => slot !== id) : [...slots.hidden, id];
    const updated = { ...slots, hidden };
    if (send({ t: 'book-slots', slots: updated })) setSlots(updated);
  };
  return <section className="atlas-player__section atlas-player__book-slots">
    <h3>{playerText('slots')}</h3>
    {DEFAULT_SLOTS.map((slot) => <label className="atlas-player__row atlas-player__book-slot" key={slot}>
      <input type="checkbox" checked={!slots.hidden.includes(slot)} disabled={disabled} onChange={() => toggleHidden(slot)} />
      <span>{DEFAULT_SLOT_NAMES[slot]}</span>
    </label>)}
    {slots.own.map((slot) => <div className="atlas-player__row atlas-player__book-slot" key={slot.id}>
      <span>{slot.name}</span>
      <Button type="button" size="sm" variant="destructive" aria-label={`${playerText('delete')} ${slot.name}`} disabled={disabled} onClick={() => { if (!disabled) { const updated = { ...slots, own: slots.own.filter((entry) => entry.id !== slot.id) }; if (send({ t: 'book-slots', slots: updated })) setSlots(updated); } }}>{playerText('delete')}</Button>
    </div>)}
    <label>{playerText('newSlot')}<input className="atlas-player__field" maxLength={24} value={newSlot} disabled={disabled} onChange={(event) => setNewSlot(event.currentTarget.value)} /></label>
    <Button type="button" size="sm" variant="outline" onClick={add} disabled={disabled || slots.own.length >= 12}>{playerText('add')}</Button>
  </section>;
}
