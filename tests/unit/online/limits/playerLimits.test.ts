// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_SERVES_PER_ASSET as servedByAssetServe, REPEAT_REQUEST_MS as repeatOfAssetServe } from '../../../../src/app/online/gm/assetServe.ts';
import { BOOK_BURST, BOOK_WRITES_PER_SECOND } from '../../../../src/app/online/gm/book/BookShare.ts';
import { CHAT_BURST, CHATS_PER_SECOND, REACT_BURST, REACTS_PER_SECOND } from '../../../../src/app/online/gm/log/logTypes.ts';
import { CHAT_BURST as chatBurstOfTableLog, REACT_BURST as reactBurstOfTableLog } from '../../../../src/app/online/gm/log/TableLog.ts';
import { MARKS_PER_SECOND as marksOfMarkCheck, markRate } from '../../../../src/app/online/gm/markCheck.ts';
import { MOVE_BURST, MOVES_PER_SECOND } from '../../../../src/app/online/gm/moveCheck.ts';
import { FIND_BURST, FINDS_PER_SECOND } from '../../../../src/app/online/gm/pins/FoundShare.ts';
import { DRAG_BURST, DRAGS_PER_SECOND } from '../../../../src/app/online/gm/playerDrags.ts';
import { ROLL_BURST, ROLLS_PER_SECOND } from '../../../../src/app/online/gm/PlayerRolls.ts';
import { REPEAT_REQUEST_MS as repeatOfSceneShare } from '../../../../src/app/online/gm/SceneShare.ts';
import {
  BOOK_LIMIT, CHAT_LIMIT, DRAG_LIMIT, FIND_LIMIT, MARKS_PER_SECOND, MAX_SERVES_PER_ASSET, MOVE_LIMIT, REACT_LIMIT, REPEAT_REQUEST_MS, ROLL_LIMIT,
} from '../../../../src/app/online/limits/playerLimits.ts';

describe('the limits a player is held to', () => {
  it('are the numbers the online beta shipped with', () => {
    expect(MOVE_LIMIT).toEqual({ burst: 8, perSecond: 6 });
    expect(DRAG_LIMIT).toEqual({ burst: 40, perSecond: 40 });
    expect(ROLL_LIMIT).toEqual({ burst: 3, perSecond: 1 });
    expect(CHAT_LIMIT).toEqual({ burst: 5, perSecond: 0.5 });
    expect(REACT_LIMIT).toEqual({ burst: 10, perSecond: 2 });
    expect(BOOK_LIMIT).toEqual({ burst: 30, perSecond: 2 });
    expect(FIND_LIMIT).toEqual({ burst: 5, perSecond: 1 });
    expect(MARKS_PER_SECOND).toBe(40);
    expect(REPEAT_REQUEST_MS).toBe(10_000);
    expect(MAX_SERVES_PER_ASSET).toBe(3);
  });

  it('are the values of the names the GM side always exported', () => {
    expect([MOVE_BURST, MOVES_PER_SECOND]).toEqual([MOVE_LIMIT.burst, MOVE_LIMIT.perSecond]);
    expect([DRAG_BURST, DRAGS_PER_SECOND]).toEqual([DRAG_LIMIT.burst, DRAG_LIMIT.perSecond]);
    expect([ROLL_BURST, ROLLS_PER_SECOND]).toEqual([ROLL_LIMIT.burst, ROLL_LIMIT.perSecond]);
    expect([CHAT_BURST, CHATS_PER_SECOND]).toEqual([CHAT_LIMIT.burst, CHAT_LIMIT.perSecond]);
    expect([REACT_BURST, REACTS_PER_SECOND]).toEqual([REACT_LIMIT.burst, REACT_LIMIT.perSecond]);
    expect([BOOK_BURST, BOOK_WRITES_PER_SECOND]).toEqual([BOOK_LIMIT.burst, BOOK_LIMIT.perSecond]);
    expect([FIND_BURST, FINDS_PER_SECOND]).toEqual([FIND_LIMIT.burst, FIND_LIMIT.perSecond]);
    expect(marksOfMarkCheck).toBe(MARKS_PER_SECOND);
    expect(repeatOfAssetServe).toBe(REPEAT_REQUEST_MS);
    expect(repeatOfSceneShare).toBe(REPEAT_REQUEST_MS);
    expect(servedByAssetServe).toBe(MAX_SERVES_PER_ASSET);
  });

  it('reach the table log under the names its callers and tests use', () => {
    expect(chatBurstOfTableLog).toBe(CHAT_LIMIT.burst);
    expect(reactBurstOfTableLog).toBe(REACT_LIMIT.burst);
  });

  it('give a mark rate the shared number for both its burst and its refill', () => {
    const rate = markRate();
    for (let count = 0; count < MARKS_PER_SECOND; count += 1) expect(rate.take('ana', 0)).toBe(true);
    expect(rate.take('ana', 0)).toBe(false);
    expect(rate.take('ana', 1000 / MARKS_PER_SECOND)).toBe(true);
  });

  it('are numbers a bucket can use: whole bursts of at least one, and a refill above nothing', () => {
    for (const limit of [MOVE_LIMIT, DRAG_LIMIT, ROLL_LIMIT, CHAT_LIMIT, REACT_LIMIT, BOOK_LIMIT, FIND_LIMIT]) {
      expect(Number.isInteger(limit.burst)).toBe(true);
      expect(limit.burst).toBeGreaterThanOrEqual(1);
      expect(limit.perSecond).toBeGreaterThan(0);
    }
  });
});
