// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MoveRate as moveRateOfMoveCheck } from '../../../../src/app/online/gm/moveCheck.ts';
import { MoveRate } from '../../../../src/app/online/limits/moveRate.ts';
import { CHAT_LIMIT, MOVE_LIMIT } from '../../../../src/app/online/limits/playerLimits.ts';

const ANA = 'a'.repeat(20);
const BEN = 'b'.repeat(20);

/** How many takes at one instant a bucket allows before it says no. */
function burstAt(rate: MoveRate, player: string, now: number): number {
  let taken = 0;
  while (rate.take(player, now) && taken < 1000) taken += 1;
  return taken;
}

describe('the rate of a player\'s moves', () => {
  it('is the class the GM side has always imported from moveCheck', () => {
    expect(moveRateOfMoveCheck).toBe(MoveRate);
  });

  it('allows the move limit\'s burst at once and no more', () => {
    expect(burstAt(new MoveRate(), ANA, 0)).toBe(MOVE_LIMIT.burst);
  });

  it('refills at the move limit\'s rate, a move every sixth of a second', () => {
    const rate = new MoveRate();
    burstAt(rate, ANA, 0);
    expect(rate.take(ANA, 1000 / MOVE_LIMIT.perSecond - 1)).toBe(false);
    expect(rate.take(ANA, 1000 / MOVE_LIMIT.perSecond)).toBe(true);
    expect(rate.take(ANA, 1000 / MOVE_LIMIT.perSecond)).toBe(false);
  });

  it('keeps a bucket per player', () => {
    const rate = new MoveRate();
    burstAt(rate, ANA, 0);
    expect(rate.take(ANA, 0)).toBe(false);
    expect(rate.take(BEN, 0)).toBe(true);
  });

  it('never saves up more than the burst, however long the player was idle', () => {
    const rate = new MoveRate();
    burstAt(rate, ANA, 0);
    expect(burstAt(rate, ANA, 3_600_000)).toBe(MOVE_LIMIT.burst);
  });

  it('takes limits of its own, with a slow refill that lets one through every two seconds', () => {
    const rate = new MoveRate(CHAT_LIMIT.burst, CHAT_LIMIT.perSecond);
    expect(burstAt(rate, ANA, 0)).toBe(CHAT_LIMIT.burst);
    expect(rate.take(ANA, 1999)).toBe(false);
    expect(rate.take(ANA, 2000)).toBe(true);
    expect(rate.take(ANA, 2000)).toBe(false);
  });

  it('counts a partial refill towards the next move, not away from it', () => {
    const rate = new MoveRate(1, 1);
    expect(rate.take(ANA, 0)).toBe(true);
    expect(rate.take(ANA, 500)).toBe(false);
    expect(rate.take(ANA, 1000)).toBe(true);
  });
});
