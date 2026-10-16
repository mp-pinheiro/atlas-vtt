import { type App, type WorkspaceLeaf } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { activeAtlasLeaf, activeStore, sceneStoreOf, selectedTokenIds, tokenLabel, workScene, type WorkScene } from './atlasView.ts';
import { obsidianHttp } from './host/obsidianHttp.ts';
import { BookShelf } from './book/BookShelf.ts';
import { createTable } from './createTable.ts';
import { newGate } from './joinGate.ts';
import { LogKeeper, type LogStore } from './log/logStore.ts';
import { OnlineTable } from './OnlineTable.ts';
import type { KnownPlayer, Ownership } from './ownership.ts';
import { seeAsPlayers } from './playerTokenVision.ts';
import { presentOnPlayerView, presentedSceneSource, showPresentedElsewhere, type ShownElsewhere } from './presentedScene.ts';
import type { SavedTable } from './savedTable.ts';
import type { TableStatus } from './TableConnection.ts';
import type { LostTable } from './tableEnd.ts';
import { DEFAULT_HOST_ORIGIN } from './host/hostSettings.ts';
import { givePlayerTokens } from './seatSource';

/** A player token of a scene, or a token a player was given there, as the GM's panels list it. */
export interface PlayerTokenRow {
  readonly tokenId: string;
  /** What the GM calls the token. */
  readonly label: string;
  /** The player the GM gave it to, or null while the GM gave it to nobody. */
  readonly owner: KnownPlayer | null;
}

export interface HostCredentials {
  key(): string | null;
  readonly origin: string;
}
const NO_HOST: HostCredentials = { key: () => null, origin: DEFAULT_HOST_ORIGIN };

function refused(text: string): null {
  showNotice(text);
  return null;
}

/**
 * The GM's side of online play, free of any panel: start and stop a table, its link and status, the
 * players (list, remove), and the scene's player tokens (list with owners, mark and unmark, give to a
 * player, take back). Panels and commands call this and redraw on `onChange`.
 */
export class OnlineControl {
  private readonly app: App;
  readonly ownership: Ownership;
  /** Keeps the running table in the companion's data (null: none runs), so a reload comes back to it. */
  private readonly save: (table: SavedTable | null) => void;
  private current: OnlineTable | null = null;
  private saved: SavedTable | null = null;
  private starting = false;
  private creation = 0;
  private ended: LostTable | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly host: HostCredentials;
  /** Atlas told that players see its presented scene online, while a table runs. */
  private shown: ShownElsewhere | null = null;
  /** The running table's log, kept with it and told to its panels. */
  readonly logs: LogKeeper;

  constructor(app: App, ownership: Ownership, save: (table: SavedTable | null) => void = () => undefined, host: HostCredentials = NO_HOST, logStore?: LogStore, private readonly shelf = new BookShelf()) {
    this.app = app;
    this.ownership = ownership;
    this.save = save;
    this.logs = new LogKeeper(logStore);
    this.host = host;
    ownership.onChange(() => this.changed());
  }

  /** Calls the listener after every change of the table, its players or the player tokens; returns the way to stop. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The running table, or null. */
  get table(): OnlineTable | null {
    return this.current;
  }

  /** The table's status, or null while none runs. */
  status(): TableStatus | null {
    return this.current?.status ?? null;
  }

  /** The join link of the running table, or null. */
  link(): string | null {
    return this.current?.link ?? null;
  }

  /** The players the running table seats, or null while none runs. */
  seats(): number | null {
    return this.current === null ? null : this.saved?.maxPlayers ?? null;
  }

  /** Whether a table is being created on the server. */
  isStarting(): boolean {
    return this.starting;
  }

  /** How the last table ended, if the server ended it and not the GM; null otherwise. Cleared by the next start. */
  lost(): LostTable | null {
    return this.ended;
  }

  /** Whether a table can be started now: none runs or is starting, and an Atlas tab is active. */
  canStart(): boolean {
    return this.current === null && !this.starting && activeAtlasLeaf(this.app) !== null;
  }

  /** Starts a table from the Atlas tab `leaf` (the active one by default); tells the GM with a notice why it cannot. Players see the scene Atlas presents to its player view. */
  async start(leaf: WorkspaceLeaf | null = activeAtlasLeaf(this.app)): Promise<OnlineTable | null> {
    if (this.current !== null || this.starting) return this.current;
    if (leaf === null || sceneStoreOf(leaf) === null) return refused('Open an Atlas map tab first.');
    const hostKey = this.host.key();
    if (hostKey === null) return refused('Configure a host key in Online settings first.');
    const creation = ++this.creation;
    const origin = this.host.origin;
    this.starting = true;
    this.changed();
    const created = await createTable(obsidianHttp, origin, hostKey).finally(() => {
      if (creation === this.creation) this.starting = false;
    });
    if (creation !== this.creation || origin !== this.host.origin || hostKey !== this.host.key()) return null;
    if ('message' in created) {
      this.changed();
      return refused(created.message);
    }
    this.ownership.reset();
    // A new table's log is empty: the last table's goes.
    this.logs.forget();
    const mapPath = sceneStoreOf(leaf)?.getState().mapPath ?? null;
    return this.run({ ...created, origin, mapPath, gate: newGate() });
  }

  /**
   * Comes back to a table saved before a reload: same link, host secret and players (their ids and
   * tokens are in the ownership kept with it); players see the scene Atlas presents again.
   */
  resume(saved: SavedTable): OnlineTable | null {
    if (this.current !== null || this.starting) return this.current;
    return this.run(saved, this.logs.saved());
  }

  /** Ends the running table for good: the link stops working and the saved table is forgotten. */
  stop(): void {
    this.creation++;
    this.starting = false;
    this.current?.end();
    this.keep(null);
    this.changed();
  }

  /** Closes the running table's connection for a reload, keeping it on the server and in the saved data. */
  close(): void {
    this.creation++;
    this.starting = false;
    const table = this.current;
    this.current = null;
    table?.close();
    this.syncShown();
  }

  /** Shows the active scene of this Atlas tab on Atlas's player view, which players online see too. */
  share(leaf: WorkspaceLeaf): void {
    if (!presentOnPlayerView(this.app, leaf)) showNotice('Atlas cannot show this map on the player view.');
  }

  /** Every player the table knows: those online first, then by name. */
  players(): KnownPlayer[] {
    return this.ownership.list();
  }

  /** Removes a player from the running table: their key stops working and their tokens are nobody's. */
  kick(playerId: string): void {
    this.current?.kick(playerId);
  }

  /** The player tokens of the shared scene as players see it (of the active Atlas tab while none is shared), with who has each. */
  playerTokens(): PlayerTokenRow[] {
    const scene = this.sharedScene();
    if (scene === null) return [];
    const { tokens } = scene.store.getState().objects;
    return this.ownership.seats(scene.mapPath, tokens).flatMap(({ tokenId, owner }) => {
      const token = tokens[tokenId];
      return token === undefined ? [] : [{ tokenId, label: tokenLabel(token), owner }];
    });
  }

  /** The tokens selected on the active Atlas tab (the shared one when none is active). */
  selectedTokens(): string[] {
    const scene = this.activeScene();
    return scene === null ? [] : selectedTokenIds(scene.store.getState());
  }

  /** Makes tokens of the shared scene player tokens, or the GM's own (which takes them back from their players). */
  markPlayerTokens(tokenIds: readonly string[], player: boolean): void {
    this.mark(this.sharedScene(), tokenIds, player);
  }

  /** Makes the tokens selected on the active Atlas tab player tokens, or the GM's own; the number of tokens changed. */
  markSelected(player: boolean): number {
    const scene = this.activeScene();
    const selected = scene === null ? [] : selectedTokenIds(scene.store.getState());
    this.mark(scene, selected, player);
    return selected.length;
  }

  /** Gives tokens to a player, or takes them back from whoever has them (null). A token nobody had sees from then on (`seeAsPlayers`). */
  give(tokenIds: readonly string[], playerId: string | null): void {
    givePlayerTokens(this.ownership, this.sharedScene()?.store ?? null, tokenIds, playerId);
  }

  /** A token that becomes a player token sees from then on (`seeAsPlayers`). */
  private mark(scene: WorkScene | null, tokenIds: readonly string[], player: boolean): void {
    if (scene === null || tokenIds.length === 0) return;
    if (player) seeAsPlayers(scene.store, tokenIds, (id, token) => !this.ownership.isPlayerToken(scene.mapPath, id, token));
    this.ownership.markPlayerTokens(scene.mapPath, tokenIds, scene.store.getState().objects.tokens, player);
  }

  private sharedScene(): WorkScene | null {
    return workScene(this.current?.sharedStore ?? activeStore(this.app));
  }

  private activeScene(): WorkScene | null {
    const shared = this.current?.sharedTab;
    return workScene(activeStore(this.app) ?? (shared === null || shared === undefined ? null : sceneStoreOf(shared)));
  }

  private run(saved: SavedTable, savedLog?: unknown): OnlineTable {
    this.ended = null;
    this.keep(saved);
    const table = new OnlineTable(this.app, saved.origin, saved, saved.mapPath, this.ownership, saved.gate, {
      status: () => this.changed(),
      gate: (gate) => {
        if (this.current === table && this.saved !== null) this.keep({ ...this.saved, gate });
      },
      changed: () => this.changed(),
      log: () => void (this.current === table && this.logs.keep(table.log.saved())),
      mapPath: (mapPath) => {
        if (this.current === table && this.saved !== null) this.keep({ ...this.saved, mapPath });
      },
      ended: (end) => {
        if (this.current !== table) return;
        this.current = null;
        this.syncShown();
        // A table the server ended is gone; one the GM stopped was dropped by `stop`, and one another Obsidian took over lives on there.
        this.ended = end === 'stopped' || end === 'replaced' ? null : end;
        if (this.ended !== null) this.keep(null);
      },
    }, this.shelf, savedLog);
    this.current = table;
    table.start();
    this.changed();
    return table;
  }

  private keep(saved: SavedTable | null): void {
    if (saved === null && this.saved === null) return;
    this.saved = saved;
    this.save(saved);
    // The log goes with its table.
    if (saved === null) this.logs.forget();
  }

  private changed(): void {
    this.syncShown();
    for (const listener of this.listeners) listener();
    this.logs.changed();
  }

  /**
   * Keeps Atlas told that players see its presented scene online for as long as a table runs, so
   * the eye on a scene tab moves the table instead of opening the local player window. A reloaded
   * Atlas has a presented scene of its own, which is told again at the next change.
   */
  private syncShown(): void {
    const source = this.current === null ? null : presentedSceneSource(this.app);
    if (this.shown !== null && this.shown.source !== source) {
      this.shown.stop();
      this.shown = null;
    }
    if (this.current !== null && this.shown === null) this.shown = showPresentedElsewhere(this.app);
  }
}
