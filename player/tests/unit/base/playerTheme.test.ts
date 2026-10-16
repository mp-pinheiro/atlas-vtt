// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as sass from 'sass';

/** `name: value` pairs of the declarations in a block of CSS. */
function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

const css = sass.compile('styles/player-theme.scss', { style: 'expanded' }).css;
const dark = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
const light = css.replace(dark, '');

const PALETTE = [
  ...['00', '05', '10', '20', '25', '30', '35', '40', '50', '60', '70', '100'].map((step) => `--color-base-${step}`),
  ...['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'].map((name) => `--color-${name}`),
  '--mono-0',
  '--mono-100',
];

describe('player theme', () => {
  it('compiles', () => {
    expect(css).toContain(':root');
  });

  it('gives the palette its light values and, under a dark colour scheme, its dark values', () => {
    const lightValues = declarations(light);
    const darkValues = declarations(dark);
    for (const name of PALETTE) {
      expect(lightValues.has(name), `light ${name}`).toBe(true);
      expect(darkValues.has(name), `dark ${name}`).toBe(true);
      expect(darkValues.get(name), name).not.toBe(lightValues.get(name));
    }
    expect(lightValues.get('--color-base-00')).toBe('#ffffff');
    expect(darkValues.get('--color-base-00')).toBe('#1e1e1e');
    expect(lightValues.get('--mono-100')).toBe('black');
    expect(darkValues.get('--mono-100')).toBe('white');
  });

  it('declares the colour scheme with each palette', () => {
    expect(light).toMatch(/color-scheme:\s*light/);
    expect(dark).toMatch(/color-scheme:\s*dark/);
  });

  it('defines the variables the shared components read for surfaces, text, type and size', () => {
    const defined = declarations(light);
    for (const name of [
      '--background-primary', '--background-secondary', '--background-modifier-hover', '--background-modifier-border',
      '--interactive-accent', '--interactive-hover', '--text-normal', '--text-muted', '--text-faint', '--text-on-accent',
      '--font-interface', '--font-monospace', '--font-ui-small', '--line-height-tight', '--radius-m', '--radius-xl',
      '--input-height', '--shadow-s', '--shadow-l', '--divider-color', '--menu-background', '--icon-opacity',
    ]) {
      expect(defined.has(name), name).toBe(true);
    }
  });

  it('reads only variables it defines itself', () => {
    const defined = new Set(declarations(light).keys());
    const read = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);
    expect(read.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('loads nothing from another origin', () => {
    expect(css).not.toMatch(/url\(|@import|https?:\/\//);
  });
});
