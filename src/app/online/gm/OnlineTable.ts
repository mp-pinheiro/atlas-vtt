import { parsePlayerMessage, type ConnectionStats } from '../protocol/index.ts';
import type { App, WorkspaceLeaf } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { randomHex } from '../../utils/randomHex';
import { scaleInWindow } from './assetVariants.ts';
import { ATLAS_VIEW_TYPE, type SceneStore } from './atlasView.ts';
import type { BookShelf } from './book/BookShelf.ts';
import { tableBook, type TableBook } from './book/tableBook.ts';
import { companionTimers, every } from './companionTimers.ts';
import type { CreatedTable } from './createdTable.ts';
import { diceSourceOf } from './atlasDice';
import { sceneRefusal } from './sceneRefusal';
import { ImageShare } from './image/ImageShare.ts';
import { PAUSED_TEXT, TableGate, type GateSettings } from './joinGate.ts';
import { gmRoll, type GmRollDraft, type GmRollRefusal } from './log/gmRolls.ts';
import { TableLog } from './log/TableLog.ts';
import type { Ownership } from './ownership.ts';
import { presentedScene, presentedSceneSource } from './presentedScene.ts';
import { bindScene, type SceneBinding } from './sceneBinding.ts';
import { TabWatch } from './sharedTab.ts';
import { TableConnection, type TableStatus } from './TableConnection.ts';
import { tableEndOf, tableEndText, type TableEnd } from './tableEnd.ts';
import { readVaultImage } from './vaultImage.ts';
import { LOST_NOTICES, type OnlineTableEvents } from './tableEvents.ts';
import { PlayerActionRates } from './PlayerActionRates.ts';
import type { PendingPaths } from './PendingPaths';
import type { ClaimRequests } from './claims';

export type { OnlineTableEvents };
import { FoundShare } from './pins/FoundShare.ts';

/** How often the presented tab is looked for, and the shared one checked. */
const WATCH_MS = 1_000;

/**
 * One running table: the socket, the join link, and the scene Atlas presents to its player view (the eye
 * on a scene tab), followed through Atlas's lifecycle (`TabWatch`). Players never follow the GM's own tab
 * switches: while the GM works on another scene tab they keep what they saw. While the presented tab is
 * gone (Atlas reloads, the tab was closed) or Atlas presents nothing, players are sent no scene; once a
 * view shows the presented scene it is shared.
 */
export class OnlineTable {
  private readonly app: App;
  private readonly connection: TableConnection;
  private readonly rates = new PlayerActionRates();
  private readonly ready = new Set<string>();
  private readonly timers = companionTimers();
  private readonly doorNonces = new Map<string, Set<string>>();
  private readonly watch: TabWatch<SceneBinding>;
  private stopWatchTimer: () => void = () => undefined;
  private stopFollowingPresented: () => void = () => undefined;
  private currentStatus: TableStatus = 'connecting';
  private readonly events: OnlineTableEvents;
  readonly ownership: Ownership;
  /** The table's gates: the join code, the two switches, and who waits for an answer. */
  readonly gate: TableGate;
  /** The table's log: chat, rolls, who came and went. */
  readonly log: TableLog;
  /** The image the GM shows every player over the map, while one is shown. */
  readonly image: ImageShare;
  /** The players' books: each one's own pages besides the table, kept on this device's shelf. */
  private readonly books: TableBook;
  /** The readable pins players find, and the notes they found. */
  private readonly found: FoundShare;
  /** The join link players open. */
  readonly link: string;
  private readonly stopOwnership: () => void;

  constructor(app: App, origin: string, table: CreatedTable, mapPath: string | null, ownership: Ownership, gate: GateSettings, events: OnlineTableEvents, shelf: BookShelf, savedLog?: unknown) {
    this.app = app;
    this.ownership = ownership;
    this.events = events;
    this.link = `${origin}/#${table.code}`;
    this.gate = new TableGate(gate, {
      send: (frame) => this.connection.sendGate(frame),
      answer: (id, admit) => this.connection.answer(id, admit),
      save: (settings) => events.gate(settings),
      changed: () => events.changed(),
      paused: () => showNotice(PAUSED_TEXT),
      timers: this.timers,
    });
    const timers = this.timers;
    this.log = new TableLog({
      send: (body, to) => this.connection.send(body, to),
      clock: () => Date.now(),
      now: () => timers.now(),
      randomId: () => randomHex(12),
      nameOf: (player) => ownership.nameOf(player),
      colourOf: player => ownership.colourOf(player),
      setTimer: (run, ms) => timers.setTimer(run, ms),
      clearTimer: (timer) => timers.clearTimer(timer),
      changed: () => events.log(),
      speaker: (who, key) => this.bound()?.share.dice.speaker(who, key) ?? Promise.resolve(null),
      rollInline: (formula) => this.bound()?.share.dice.quietRoll(formula) ?? null,
    }, savedLog);
    this.image = new ImageShare({
      send: (body, to, valid) => this.connection.send(body, to, valid === undefined ? undefined : { recipient: to ?? '*', valid }),
      now: () => timers.now(),
      randomId: () => randomHex(12),
      scaleImage: scaleInWindow,
      changed: () => events.changed(),
      logShown: (shown, path) => this.log.imageShown(shown, path),
      loggedFile: (hash, viewer) => this.log.artFile(hash, viewer),
      readImage: (path) => readVaultImage(app, path),
    });
    this.found = new FoundShare(this.log, {
      app, send: (body, to, valid) => this.connection.send(body, to, valid === undefined ? undefined : { recipient: to ?? '*', valid }), now: () => timers.now(), nameOf: (player) => ownership.nameOf(player),
      readImage: (path) => readVaultImage(app, path), scaleImage: scaleInWindow,
      readablePin: (from, scene, alias) => this.bound()?.share.readablePin(from, scene, alias) ?? null,
      changed: () => this.bound()?.share.pinsChanged(),
    });
    this.books = tableBook({
      app, shelf, ownership, randomId: () => randomHex(12),
      send: (body, to, valid) => this.connection.send(body, to, valid === undefined ? undefined : { recipient: to, valid }),
      scene: () => this.bound()?.book() ?? null,
      readImage: (path) => readVaultImage(app, path),
      tokenWrites: () => this.bound()?.resources ?? null,
      diceRules: () => { const leaf = this.sharedTab; return leaf === null ? null : diceSourceOf(leaf)?.rules() ?? null; },
      sceneId: token => {
        const owner = ownership.ownerOf(token.id, token);
        return owner === undefined ? null : this.bound()?.share.authority(owner)?.scene ?? null;
      },
    });
    this.watch = new TabWatch<SceneBinding>({
      leaves: () => app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE),
      presented: () => presentedScene(app),
      bind: (tab, presented) => bindScene({
        app,
        seats: ownership,
        log: this.log,
        doorNonces: this.doorNonces,
        playedCharacter: from => { this.books.share.update(); return this.books.share.characterOf(from); },
        readyPlayers: () => [...this.ready],
        refreshSheet: from => this.books.share.refreshSheet(from),
        send: (body, to, validity) => this.connection.send(body, to, validity),
        actionAllowed: (from) => this.rates.action(from, timers.now()),
        movementAllowed: (from) => this.rates.movement(from, timers.now()),
        sendLive: (body, key, to, validity) => this.connection.sendLive(body, key, to, validity),
        readImage: (path) => readVaultImage(app, path),
        isLive: (binding) => this.watch.isLive(binding),
        randomId: () => randomHex(12),
        logRoll: (roll) => this.log.rolled(roll),
        logArt: (hash, viewer) => this.log.artFile(hash, viewer),
        rollRequest: (from, answer) => this.log.requestOf(from, answer),
        foundPin: (map, pin) => this.found.entryOf(map, pin),
        nameOf: (player) => ownership.nameOf(player),
      }, tab, presented),
      lost: (reason) => {
        this.withdraw();
        const notice = LOST_NOTICES[reason];
        if (notice !== null) showNotice(notice);
      },
      mapPath: (path) => events.mapPath(path),
    }, mapPath);
    this.connection = new TableConnection(origin, table.code, table.secret, {
      status: (status) => this.setStatus(status),
      // The scene and tokens first: the players' mine messages follow from the ownership change.
      welcome: (players) => {
        this.ready.clear();
        // Who came or went while the GM was away is in the log before it goes out again.
        this.log.welcome(players);
        this.resend();
        ownership.welcome(players);
      },
      joined: (player) => {
        // The log as it was, then the line that they joined, which everyone gets.
        this.resend(player.id);
        ownership.joined(player);
        this.log.joined(player);
      },
      left: (player) => {
        this.ready.delete(player);
        this.doorNonces.delete(player);
        this.bound()?.share.playerLeft(player);
        this.rates.playerLeft(player);
        this.image.playerLeft(player);
        this.books.share.playerLeft(player);
        this.found.playerLeft(player);
        ownership.left(player);
        this.log.left(player);
      },
      // The log, the shown image and the books are the table's, so they hear players while no scene is shared too.
      message: (from, body) => this.receive(from, body),
    }, this.gate);
    this.stopOwnership = ownership.onChange(() => { this.log.publishPeople(); this.bound()?.share.ownersChanged(); });
  }

  /** The Atlas tab players see live: bound, and showing the presented scene now; null while there is none. */
  get sharedTab(): WorkspaceLeaf | null {
    const binding = this.watch.binding;
    return binding?.showing === true ? this.watch.current?.leaf ?? null : null;
  }

  /** The shared scene's store as players see it (frozen while the GM works on another tab), or null while none is shared. */
  get sharedStore(): SceneStore | null {
    return this.watch.binding?.store ?? null;
  }

  /** The name of the scene tab Atlas presents, or null while it presents none of the open tabs. */
  get presentedName(): string | null {
    return this.watch.presented?.name ?? null;
  }

  get status(): TableStatus {
    return this.currentStatus;
  }

  get pendingPaths(): PendingPaths | null { return this.bound()?.share.agency?.paths ?? null; }
  get claimRequests(): ClaimRequests | null { return this.bound()?.share.agency?.claims ?? null; }

  /** How the table's connection went, for feedback's diagnostics. */
  connectionStats(): ConnectionStats {
    return this.connection.stats();
  }

  /** A GM's roll from the log (its composer, a roll button, another plugin), on the shared scene's dice. */
  rollFromLog(draft: GmRollDraft): Promise<GmRollRefusal | null> {
    const binding = this.bound();
    return gmRoll(draft, this.log, binding?.share.dice ?? null, binding?.store ?? null);
  }

  /** Removes a player: their key stops working, their browser leaves the table and their tokens are nobody's. */
  kick(player: string): void {
    this.connection.kick(player);
    this.ownership.remove(player);
  }

  start(): void {
    try {
      this.connection.start();
      this.books.start();
      this.found.start();
      this.watch.check();
      this.stopWatchTimer = every(this.timers, WATCH_MS, () => this.watch.check());
      this.stopFollowingPresented = presentedSceneSource(this.app)?.onChange(() => this.watch.check()) ?? ((): void => undefined);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** Looks at the presented and the shared tab again (the workspace's layout changed). */
  checkLeaf(): void {
    this.watch.check();
  }

  /** Ends the table on the server and stops sharing. */
  end(): void {
    this.stopWatch();
    this.connection.end();
  }

  /** Closes the socket and stops sharing, leaving the table on the server: a reload comes back to it. */
  close(): void {
    this.stopWatch();
    this.connection.stop();
  }

  private setStatus(status: TableStatus): void {
    this.currentStatus = status;
    if (status === 'stopped') this.finish('stopped');
    else if (status === 'refused') {
      const end = tableEndOf(this.connection.closeCode);
      showNotice(tableEndText(end));
      this.finish(end);
    }
    this.events.status(status);
  }

  private finish(end: 'stopped' | TableEnd): void {
    this.stopWatch();
    this.rates.clear();
    this.ready.clear();
    this.doorNonces.clear();
    this.stopOwnership();
    this.gate.dispose();
    this.log.dispose();
    this.books.stop();
    this.events.ended(end);
  }


  private stopWatch(): void {
    this.found.stop();
    this.stopWatchTimer();
    this.stopFollowingPresented();
    this.watch.stop();
  }

  /** The binding of the tab shared now, while it is still the same tab; null while there is none. */
  private bound(): SceneBinding | null {
    const binding = this.watch.binding;
    return binding !== null && this.watch.isLive(binding) ? binding : null;
  }

  private receive(from: string, body: unknown): void {
    if (!this.ownership.onlinePlayers().includes(from)) return;
    const message = parsePlayerMessage(body);
    if (message?.t === 'player-ready') {
      this.ready.add(from);
      this.resend(from);
      return;
    }
    if (message?.t === 'colour') {
      if (this.rates.action(from, this.timers.now())) this.ownership.setColour(from, message.colour);
      return;
    }
    if (message?.t === 'book-parts') {
      this.books.share.receive(from, message);
      return;
    }
    if (this.log.receive(from, body) || this.image.receive(from, body) || this.found.receive(from, body) || this.books.share.receive(from, body)) return;
    const binding = this.bound();
    if (binding !== null) return binding.share.receive(from, body);
    if (message === null) return;
    const refusal = sceneRefusal(message);
    if (refusal === null) return;
    switch (message.t) {
      case 'move': case 'path': case 'path-cancel': case 'door': case 'condition': this.rates.movement(from, this.timers.now()); break;
      case 'roll': case 'sheet-roll': case 'initiative-roll': case 'end-turn': this.rates.action(from, this.timers.now()); break;
    }
    this.connection.send(refusal, from);
    if (message.t === 'sheet-roll') this.books.share.refreshSheet(from);
  }

  /** The scene, tokens and the rest to one player or to all, or no scene while the shared tab is gone; then the log, the shown image and the books. */
  private resend(to?: string): void {
    const binding = this.bound();
    if (binding === null) this.connection.send({ t: 'scene', scene: null }, to);
    else binding.share.resend(to);
    this.log.resend(to);
    this.image.resend(to);
    this.books.share.resend(to);
  }

  /** Players see no scene while the shared tab is gone, so nothing of what they saw lingers or moves. */
  private withdraw(): void {
    this.connection.send({ t: 'scene', scene: null });
  }
}
