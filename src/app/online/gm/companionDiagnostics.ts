import {
  BUILD, ErrorReporter, FEEDBACK_PATH, REPORTS_PATH, feedbackResultOf, shownJoinCode, tableTag, withoutKnown,
  type ConnectionStats, type Environment, type FeedbackPost, type FeedbackResult,
} from '../protocol/index.ts';
import { apiVersion, Platform, requestUrl } from 'obsidian';
import type { CompanionFeedback } from './companionReports.ts';

/** Where the companion's own code runs in a stack: Obsidian names a plugin's script by its id. */
const OWN_FRAMES = 'plugin:atlas-online';

/** What the companion knows: whether and where to send, and what a report must never carry. */
export interface CompanionFacts {
  /** Whether the GM switched error reports on (off by default). */
  reportErrors(): boolean;
  setReportErrors(on: boolean): void;
  /** The relay address in the GM's settings now (an origin), or null while none is entered: reports and feedback go nowhere then. */
  relayOrigin(): string | null;
  /** The running table's code, host secret and join code, or null. */
  table(): { readonly code: string; readonly secret: string; readonly gate: { readonly code: string } } | null;
  /** The names of the table's players. */
  playerNames(): readonly string[];
  connection(): ConnectionStats | null;
}

async function postJson(url: string, body: unknown): Promise<number> {
  const response = await requestUrl({ url, method: 'POST', contentType: 'application/json', body: JSON.stringify(body), throw: false });
  return response.status;
}

/**
 * The companion's diagnostics: its own uncaught errors and unhandled rejections (those whose stack runs
 * through this plugin; Obsidian's and other plugins' are left alone) are named in the console, and go to
 * the relay the GM entered only once they switched error reports on (off by default: Obsidian's developer
 * policy and §25 TDDDG), once each and rate-limited, redacted of the table's code and secret, its join
 * code and the players' names. Feedback from the online panel goes there when the GM sends it. With no
 * relay address entered nothing is sent, whatever the switches say.
 */
export class CompanionDiagnostics implements CompanionFeedback {
  readonly reporter: ErrorReporter;
  private readonly facts: CompanionFacts;
  private readonly version: string;
  /** The Atlas plugin's version, read when a report is made: Atlas may load after the companion. */
  private readonly atlasVersion: () => string | null;

  constructor(facts: CompanionFacts, version: string, atlasVersion: () => string | null) {
    this.facts = facts;
    this.version = version;
    this.atlasVersion = atlasVersion;
    this.reporter = new ErrorReporter({
      source: 'companion',
      environment: () => this.environment(),
      table: () => this.tag(),
      known: () => {
        const table = facts.table();
        return [table?.code ?? '', table?.secret ?? '', ...this.joinCodes(), ...facts.playerNames()].filter((text) => text !== '');
      },
      post: async (report) => {
        const origin = facts.relayOrigin();
        if (origin !== null) await postJson(`${origin}${REPORTS_PATH}`, report);
      },
      now: () => Date.now(),
      enabled: () => this.sendsReports(),
    });
  }

  /** Reports this plugin's uncaught errors in `win`; returns the way to stop. */
  listen(win: Window): () => void {
    const error = (event: ErrorEvent): void => this.capture('error', event.error);
    const rejection = (event: PromiseRejectionEvent): void => this.capture('rejection', event.reason);
    win.addEventListener('error', error);
    win.addEventListener('unhandledrejection', rejection);
    return () => {
      win.removeEventListener('error', error);
      win.removeEventListener('unhandledrejection', rejection);
    };
  }

  reportsErrors(): boolean {
    return this.facts.reportErrors();
  }

  setReportErrors(on: boolean): void {
    this.facts.setReportErrors(on);
  }

  async send(text: string, withDiagnostics: boolean): Promise<FeedbackResult> {
    const origin = this.facts.relayOrigin();
    if (origin === null) return 'failed';
    const post: FeedbackPost = {
      // What the GM wrote goes as written, but for the join code: a pasted one stops being one.
      v: 1, source: 'companion', text: withoutKnown(text, this.joinCodes()),
      diagnostics: withDiagnostics ? { ...this.environment(), table: await this.tag(), errors: this.reporter.recentIds(), connection: this.facts.connection() } : null,
    };
    try {
      return feedbackResultOf(await postJson(`${origin}${FEEDBACK_PATH}`, post));
    } catch {
      return 'failed';
    }
  }

  private capture(kind: 'error' | 'rejection', thrown: unknown): void {
    if (!(thrown instanceof Error) || thrown.stack?.includes(OWN_FRAMES) !== true) return;
    void this.reporter.capture(kind, thrown).then((id) => {
      if (id === null) return;
      console.warn(`Atlas Online: error ${id}${this.whereReported()}`);
    });
  }

  /** Whether a report would leave now: the GM switched them on and entered a relay address to send them to. */
  private sendsReports(): boolean {
    return this.facts.reportErrors() && this.facts.relayOrigin() !== null;
  }

  /** What the console says of where an error went. */
  private whereReported(): string {
    if (!this.facts.reportErrors()) return ' (error reports are off, nothing was sent)';
    const origin = this.facts.relayOrigin();
    return origin === null ? ' (no relay address is entered, nothing was sent)' : ` reported to ${new URL(origin).host}`;
  }

  /** The running table's join code, as kept and as shown. */
  private joinCodes(): string[] {
    const code = this.facts.table()?.gate.code;
    return code === undefined ? [] : [code, shownJoinCode(code)];
  }

  /** The companion's build and Atlas's version, Obsidian's version and the system's family. */
  private environment(): Environment {
    const atlas = this.atlasVersion();
    const build = `${this.version}+${BUILD}${atlas === null ? '' : ` atlas ${atlas}`}`.slice(0, 80);
    return { build, browser: `Obsidian ${apiVersion}`, os: Platform.isMacOS ? 'macOS' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : 'Other' };
  }

  private async tag(): Promise<string | null> {
    const table = this.facts.table();
    return table === null ? null : tableTag(table.code).catch(() => null);
  }
}
