import { MOVE_LIMIT } from './playerLimits.ts';

/** A token bucket per player for their moves (or, with other limits, any other kind of message they send). */
export class MoveRate {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly burst: number;
  private readonly perSecond: number;

  constructor(burst: number = MOVE_LIMIT.burst, perSecond: number = MOVE_LIMIT.perSecond) {
    this.burst = burst;
    this.perSecond = perSecond;
  }

  /** Takes one message of the player's; false when they are over their rate. */
  take(player: string, now: number): boolean {
    const bucket = this.buckets.get(player) ?? { tokens: this.burst, at: now };
    bucket.tokens = Math.min(this.burst, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond);
    bucket.at = now;
    this.buckets.set(player, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
