import { describe, expect, it } from 'vitest';
import { EVENT_RETRY_MS, GM_AWAY_MS, SECRET_BYTES, TABLE_CODE_BYTES } from '../src/table/limits.ts';

// The numbers below are the ones the spec and PRIVACY.md promise. They are written out in plain
// units here, so changing one in limits.ts is a visible, deliberate change of a promise.
describe('the numbers of the relay\'s table rules', () => {
  it('lets a table live 24 hours without its GM', () => {
    expect(GM_AWAY_MS).toBe(86_400_000);
  });

  it('makes a table code of 128 random bits and a host secret of 256', () => {
    expect(TABLE_CODE_BYTES).toBe(16);
    expect(SECRET_BYTES).toBe(32);
  });

  it('tries an event whose handler failed again a minute later', () => {
    expect(EVENT_RETRY_MS).toBe(60_000);
  });
});
