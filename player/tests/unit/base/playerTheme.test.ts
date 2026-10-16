// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sass from 'sass';

/** `name: value` pairs of the declarations in a block of CSS. */
function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

/** The folders whose stylesheets the page mounts: the table log, the marks and the primitives (design 6.2b). */
const MOUNTED_FOLDERS = ['src/app/online/marks/styles', 'src/app/online/tableLog/styles', 'src/app/packages/components/primitives'];
/** The single stylesheets it mounts, with the tokens and mixins that all of them use. */
const MOUNTED_FILES = [
  'src/app/react/components/dice/dice-toast.scss',
  'src/app/react/components/dice/rolled-dice.scss',
  'src/app/react/components/dice3d/dice-roll.scss',
  'src/app/packages/components/shared/token-portrait.scss',
  'src/app/packages/token.scss',
  'src/app/react/components/widget-bar.scss',
  'styles/_native-tooltips.scss',
  'styles/_notices.scss',
  'styles/_tokens.scss',
  'styles/_mixins.scss',
];

/** The source of every mounted stylesheet, without its comments. */
function mountedStyles(): string {
  const inFolders = MOUNTED_FOLDERS.flatMap((folder) =>
    readdirSync(folder).filter((name) => name.endsWith('.scss')).map((name) => `${folder}/${name}`));
  return [...inFolders, ...MOUNTED_FILES]
    .map((file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
    .join('\n');
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
      '--input-shadow', '--input-shadow-hover',
    ]) {
      expect(defined.has(name), name).toBe(true);
    }
  });

  it('draws the input shadows as a border inside the control, in the colours of the theme', () => {
    const defined = declarations(light);
    expect(defined.get('--input-shadow')).toMatch(/^inset 0 0 0 .*var\(--background-modifier-border\)$/);
    expect(defined.get('--input-shadow-hover')).toMatch(/^inset 0 0 0 .*var\(--background-modifier-border-hover\)$/);
  });

  it('defines every Obsidian variable that the stylesheets the page mounts read, unless they set it or read it with a fallback', () => {
    const sheets = mountedStyles();
    const reads = [...sheets.matchAll(/var\(\s*(--[\w-]+)\s*(,?)/g)].map((match) => ({ name: match[1]!, fallback: match[2] === ',' }));
    // Guards the list above: a folder that moved would leave nothing to read and pass without checking.
    expect(reads.map((read) => read.name)).toEqual(expect.arrayContaining(['--text-normal', '--background-modifier-border', '--interactive-accent']));
    const defined = new Set(declarations(light).keys());
    const setByStyles = new Set([...sheets.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((match) => match[1]!));
    const undefinedNames = new Set(
      reads
        .filter((read) => !read.fallback)
        // `--atlas-*` are Atlas' own tokens, which the stylesheets, the components or the Atlas VTT theme set; they are not Obsidian's.
        .map((read) => read.name)
        .filter((name) => !name.startsWith('--atlas-') && !defined.has(name) && !setByStyles.has(name)),
    );
    expect([...undefinedNames]).toEqual([]);
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
