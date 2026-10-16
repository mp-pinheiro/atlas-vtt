import { GM_MARKS, type MarksMessage, type MeasureState, type SharedMeasure } from '../protocol';
import type { Measurements } from '../../pixi/MeasureRenderer';
import { measureOriginOf, measureShownToPlayers, UNSEEN_MEASURE_ORIGIN, type MeasureOrigin, type TokenFootprint, type TokenSeen } from '../../vision/measureOrigin';
import type { Press } from '../marks';
import { GmMeasures } from './gmMeasures';

interface StartedMeasure {
  readonly measure: SharedMeasure;
  readonly origin: MeasureOrigin;
}

function measureKey(measure: SharedMeasure): string {
  return JSON.stringify([measure.shape, measure.a, measure.b]);
}
const UNOBSERVED_SIGHT: TokenSeen = () => false;

class PlayerMeasureOrigins {
  private live: StartedMeasure | null = null;
  private lastLive: StartedMeasure | null = null;
  private kept = new Map<string, MeasureOrigin>();
  private counts = new Map<string, number>();

  follow(state: MeasureState, footprints: readonly TokenFootprint[], seen: TokenSeen): void {
    const previous = this.live;
    if (state.live === null) this.live = null;
    else {
      const fresh = previous === null || previous.measure.a[0] !== state.live.a[0] || previous.measure.a[1] !== state.live.a[1];
      const origin = fresh ? measureOriginOf([{ x: state.live.a[0], y: state.live.a[1] }], footprints, seen) : previous.origin;
      this.live = { measure: state.live, origin };
      this.lastLive = this.live;
    }
    const kept = new Map<string, MeasureOrigin>();
    const counts = new Map<string, number>();
    for (const measure of state.kept) {
      const key = measureKey(measure);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const measure of state.kept) {
      const key = measureKey(measure);
      let origin = this.kept.get(key);
      const last = this.lastLive;
      const inherited = last !== null && measureKey(last.measure) === key ? last.origin : undefined;
      if (origin === undefined) origin = inherited ?? UNSEEN_MEASURE_ORIGIN;
      else if (inherited !== undefined && inherited !== origin && (previous !== null && state.live === null || (counts.get(key) ?? 0) > (this.counts.get(key) ?? 0))) {
        origin = { tokenIds: [...new Set([...origin.tokenIds, ...inherited.tokenIds])], unseenAtStart: origin.unseenAtStart || inherited.unseenAtStart };
      }
      kept.set(key, origin);
    }
    this.kept = kept;
    this.counts = counts;
  }

  shown(measure: SharedMeasure, live: boolean, seen: TokenSeen): boolean {
    const origin = live ? this.live !== null && measureKey(this.live.measure) === measureKey(measure) ? this.live.origin : undefined : this.kept.get(measureKey(measure));
    return origin !== undefined && measureShownToPlayers(origin, seen);
  }

  fork(): PlayerMeasureOrigins {
    const fork = new PlayerMeasureOrigins();
    fork.live = this.live;
    fork.lastLive = this.lastLive;
    fork.kept = new Map(this.kept);
    fork.counts = new Map(this.counts);
    return fork;
  }
}

interface RecipientMeasures {
  readonly gm: GmMeasures;
  readonly players: Map<string, PlayerMeasureOrigins>;
  measures: string | undefined;
}

export class RecipientMarks {
  private readonly recipients = new Map<string, RecipientMeasures>();
  private readonly players = new Map<string, PlayerMeasureOrigins>();
  private readonly gmHistory = new GmMeasures('unseen');
  private last: MarksMessage | null = null;

  constructor(private readonly shown: (player: string) => ReadonlySet<string> | null, private readonly footprints: () => readonly TokenFootprint[], private readonly now: () => number) {}

  recordGm(records: Measurements | null, press: Press | null): void {
    const footprints = this.footprints();
    if (records === null) this.gmHistory.reset();
    else this.gmHistory.follow(records, press, { footprints: () => footprints, seen: () => UNOBSERVED_SIGHT }, this.now());
    for (const [player, entry] of this.recipients) {
      if (records === null) { entry.gm.reset(); continue; }
      const shown = this.shown(player);
      entry.gm.follow(records, press, { footprints: () => footprints, seen: () => id => shown?.has(id) === true }, this.now());
    }
  }

  recordPlayer(from: string, state: MeasureState): void {
    const footprints = this.footprints();
    const history = this.players.get(from) ?? new PlayerMeasureOrigins();
    history.follow(state, footprints, UNOBSERVED_SIGHT);
    this.players.set(from, history);
    for (const [player, entry] of this.recipients) {
      const origins = entry.players.get(from) ?? new PlayerMeasureOrigins();
      const shown = this.shown(player);
      origins.follow(state, footprints, id => shown?.has(id) === true);
      entry.players.set(from, origins);
    }
  }

  filter(player: string, body: MarksMessage): MarksMessage {
    this.last = body;
    const next = this.filtered(player, body);
    const entry = this.recipients.get(player);
    if (entry !== undefined) entry.measures = JSON.stringify(next.measures);
    return next;
  }

  recheck(player: string): MarksMessage | null {
    this.cache(player);
    if (this.last === null) return null;
    const next = this.filtered(player, this.last);
    const entry = this.recipients.get(player);
    const text = JSON.stringify(next.measures);
    if (entry === undefined || text === entry.measures) return null;
    entry.measures = text;
    return { ...next, lasers: next.lasers.map(({ span: _span, ...laser }) => ({ ...laser, pts: [] })) };
  }

  playerLeft(player: string): void {
    this.recipients.delete(player);
    this.players.delete(player);
    for (const entry of this.recipients.values()) entry.players.delete(player);
  }

  reset(): void {
    this.recipients.clear(); this.players.clear(); this.gmHistory.reset(); this.last = null;
  }

  private cache(player: string): RecipientMeasures | null {
    const shown = this.shown(player);
    if (shown === null) return null;
    let entry = this.recipients.get(player);
    if (entry !== undefined) return entry;
    entry = { gm: this.gmHistory.forkOrigins(), players: new Map([...this.players].map(([from, history]) => [from, history.fork()])), measures: undefined };
    this.recipients.set(player, entry);
    return entry;
  }

  private filtered(player: string, body: MarksMessage): MarksMessage {
    const entry = this.cache(player);
    const shown = this.shown(player);
    if (entry === null || shown === null) return { ...body, measures: [] };
    const seen = (id: string): boolean => shown.has(id);
    const measures = body.measures.flatMap(measure => {
      if (measure.who === GM_MARKS) {
        const { live, kept } = entry.gm.shown(seen);
        return live === null && kept.length === 0 ? [] : [{ ...measure, live, kept }];
      }
      const origins = entry.players.get(measure.who);
      const live = measure.live !== null && origins?.shown(measure.live, true, seen) ? measure.live : null;
      const kept = measure.kept.filter(value => origins?.shown(value, false, seen) === true);
      return live === null && kept.length === 0 ? [] : [{ ...measure, live, kept }];
    });
    return { ...body, measures };
  }
}
