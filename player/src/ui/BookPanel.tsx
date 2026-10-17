import { Button } from '../../../src/app/packages/components/primitives/button.tsx';
import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { PlayerBook } from '../../../src/app/online/protocol/book.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { playerText } from '../i18n.ts';
import { BookLoading, Character, Items, Notes, Pins, Purse, Quests, Slots, type BookSend, type BookSheetRenderer } from './book/BookSections.tsx';
import { WorldMap } from './book/WorldMap.tsx';

type BookTab = 'character' | 'items' | 'notes' | 'pins' | 'purse' | 'quests' | 'world-map';
const BOOK_TABS: readonly BookTab[] = ['character', 'items', 'notes', 'pins', 'purse', 'quests', 'world-map'];

export interface BookPanelProps {
  readonly book: PlayerBook | null;
  readonly assets: AssetDownloads;
  readonly send: BookSend;
  readonly renderSheet?: BookSheetRenderer;
  readonly characterControls?: ReactNode;
  readonly disabled?: boolean;
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

export function BookPanel({ book, assets, send, renderSheet, characterControls, disabled = false }: BookPanelProps): ReactElement {
  const [tab, setTab] = useState<BookTab>('character');
  const [worldOpen, setWorldOpen] = useState(false);
  const activeTab = `atlas-player-book-tab-${tab}`;
  const panelId = 'atlas-player-book-panel';
  const moveTab = (event: KeyboardEvent<HTMLElement>): void => {
    const currentIndex = BOOK_TABS.indexOf(tab);
    let targetIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (currentIndex + 1) % BOOK_TABS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (currentIndex + BOOK_TABS.length - 1) % BOOK_TABS.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = BOOK_TABS.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    const next = BOOK_TABS[targetIndex];
    if (next === undefined) return;
    setTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#atlas-player-book-tab-${next}`)?.focus();
  };
  const content = book === null ? tab === 'character'
    ? <Character book={null} send={send} renderSheet={renderSheet} characterControls={characterControls} disabled={disabled} />
    : <BookLoading />
    : (() => {
      switch (tab) {
        case 'character': return <Character book={book} send={send} renderSheet={renderSheet} characterControls={characterControls} disabled={disabled} />;
        case 'items': return <div className="atlas-player__section"><Items book={book} send={send} disabled={disabled} /><Slots book={book} send={send} disabled={disabled} /></div>;
        case 'notes': return <Notes book={book} send={send} disabled={disabled} />;
        case 'pins': return <Pins book={book} send={send} disabled={disabled} />;
        case 'purse': return <Purse book={book} send={send} disabled={disabled} />;
        case 'quests': return <Quests book={book} assets={assets} send={send} disabled={disabled} />;
        case 'world-map': return <WorldMap worldMap={worldOpen ? book.worldMap : null} pins={book.pins} assets={assets} send={send} disabled={disabled} />;
      }
    })();
  return <section className="atlas-player__book-panel" aria-label={playerText('tabBook')}>
    <nav className="atlas-player__book-nav" role="tablist" aria-label={playerText('tabBook')} onKeyDown={moveTab}>
      {BOOK_TABS.map((page) => <Button
        key={page}
        id={`atlas-player-book-tab-${page}`}
        type="button"
        size="sm"
        variant={tab === page ? 'secondary' : 'ghost'}
        className="atlas-player__book-tab"
        role="tab"
        aria-selected={tab === page}
        aria-controls={panelId}
        tabIndex={tab === page ? 0 : -1}
        onClick={() => setTab(page)}
      >{playerText(BOOK_TAB_LABELS[page])}</Button>)}
    </nav>
    {tab === 'world-map' && !worldOpen && <Button type="button" size="sm" variant="outline" disabled={book?.worldMap == null} onClick={() => setWorldOpen(true)}>{playerText('openWorldMap')}</Button>}
    <div className="atlas-player__book-content" role="tabpanel" id={panelId} aria-labelledby={activeTab} tabIndex={0}>
      {content}
    </div>
  </section>;
}
