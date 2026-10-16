import { describe, expect, it } from 'vitest';
import { diceFontClass } from '../../../src/app/dice3d/diceLook';
import { diceFontClass as hookDiceFontClass } from '../../../src/app/react/hooks/useDiceLook';

describe('diceFontClass', () => {
  it('names the class of the sci-fi numerals and nothing for the pencil drawing', () => {
    expect(diceFontClass({ colour: 'light', font: 'scifi' })).toBe('atlas-dice-font--scifi');
    expect(diceFontClass({ colour: 'accent', font: 'medieval' })).toBe(false);
  });

  it('is the one the dice hooks still offer', () => {
    expect(hookDiceFontClass).toBe(diceFontClass);
  });
});
