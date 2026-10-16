import fs from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { checkBoundaries } from '../../../scripts/boundaries/graph.mjs';
import * as manifest from '../../../scripts/boundaries.mjs';

/** What the players' browser client draws tokens, the camera, scrolling and rolls with, shared with the plugin as it is. */
const SHARED_DRAWING = [
  ...['spriteTypes', 'SpriteFactory', 'tokenArtwork', 'tokenRingMetrics', 'tokenRingTexture', 'ConditionBadge', 'ConditionBadgeRing', 'conditionGlyphTexture',
    'DownedTokenOverlay', 'downedEmblemTexture', 'isTokenDowned', 'HiddenTokenIcon', 'tokenDisplayName', 'nameplateVisibility', 'InstanceBadge',
    'instanceBadgeParts', 'AnimatedBarFill', 'PlayerSightTokens'].map((name) => `src/app/pixi/token-renderer/${name}.ts`),
  ...['ResourceBarView', 'ResourceStack', 'ResourceWheelView', 'ResourceWheels', 'wheelAnchor', 'wheelGeometry'].map((name) => `src/app/pixi/token-renderer/resources/${name}.ts`),
  ...['ResourceBarLabel', 'resourceBarFill', 'zoomRange', 'fitMapRect', 'SmoothWheelZoom'].map((name) => `src/app/pixi/${name}.ts`),
  'src/app/resources/resourceColors.ts',
  'src/app/resources/resourceValues.ts',
  'src/app/styles/designTokens.ts',
  'src/app/utils/conditionGlyph.ts',
  'src/app/utils/scrollWithin.ts',
  'src/app/react/components/dice/DiceRolls.tsx',
  'src/app/react/components/dice/useDiceToasts.ts',
  'src/app/audio/diceRevealSound.ts',
];

/** The plugin's own end of what is shared: the types it names the token UI in, and the wrapper that binds the roll display to its settings. */
const STAYS_WITH_THE_PLUGIN = [
  'src/app/pixi/token-renderer/types.ts',
  'src/app/react/components/dice/DiceRollDisplay.tsx',
  'src/app/react/components/dice/useDiceAvatar.ts',
  'src/app/pixi/viewportNavigation.ts',
];

describe('drawing code shared with the players\' browser client', { timeout: 30_000 }, () => {
  const { include, exclude } = manifest.BOUNDARIES.shared;
  const shared = new Set(ts.sys.readDirectory('.', ['.ts', '.tsx'], exclude, include).map((file) => file.replace(/^\.\//, '')));

  it('belongs to the shared sources', () => {
    expect(SHARED_DRAWING.filter((file) => !shared.has(file))).toEqual([]);
  });

  it('is type-checked with them, by the project that stubs Obsidian out', () => {
    const project = JSON.parse(fs.readFileSync('tsconfig.shared.json', 'utf8')) as { include: string[] };
    expect(SHARED_DRAWING.filter((file) => !project.include.includes(file))).toEqual([]);
  });

  it('imports nothing outside the shared sources and the packages they may use', () => {
    const { violations } = checkBoundaries('.', manifest);
    expect(violations.filter((line) => SHARED_DRAWING.some((file) => line.startsWith(`${file}:`)))).toEqual([]);
  });

  it('leaves what is bound to the plugin with the plugin', () => {
    expect(STAYS_WITH_THE_PLUGIN.filter((file) => shared.has(file))).toEqual([]);
  });
});
