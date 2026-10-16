import { describe, expect, it } from 'vitest';
import { bookUpdate, sentOf } from '../../../../src/app/online/gm/book/sentBook';
import type { PlayedCharacter } from '../../../../src/app/online/gm/book/characters';

const character: PlayedCharacter = {
  collection: 'Campaign', key: 'hero.webp', tokenId: 'first', mapPath: 'first.atlasmap', placed: { imagePath: 'hero.webp' },
  sheet: { name: 'Hero', art: null, ring: null, resources: [] },
};
const quests = [] as const;

describe('book character authority invalidation', () => {
  it('emits a sheet part for a different placement with byte-identical character fields', () => {
    const before = sentOf(character, null, quests);
    const after = sentOf({ ...character, tokenId: 'second' }, null, quests);
    expect(bookUpdate(before, after, true)).toEqual({ map: false, quests: false, sheet: true });
  });

  it('emits a sheet part when the character moves to another scene without changing display fields', () => {
    const before = sentOf(character, null, quests);
    const after = sentOf({ ...character, mapPath: 'second.atlasmap' }, null, quests);
    expect(bookUpdate(before, after, true)).toEqual({ map: false, quests: false, sheet: true });
    expect(bookUpdate(after, sentOf({ ...character, mapPath: 'second.atlasmap' }, null, quests), true)).toBeNull();
  });
});
