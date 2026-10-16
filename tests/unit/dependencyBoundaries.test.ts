import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkBoundaries } from '../../scripts/boundaries/graph.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A Git repository with `files` staged, so the checker lists them as it does in the real one. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'atlas-boundary-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  return root;
}

function fixture(source: string) {
  const root = repository({
    'src/shared/entry.ts': source,
    'src/shared/value.ts': 'export interface Value { x: number }\nexport const value = 1;',
    'src/plugin/service.ts': 'export interface Secret { private: true }',
    'src/assets/icon.svg': '<svg/>',
    'private/icon.svg': '<svg/>',
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Node', baseUrl: '.', paths: { 'src/*': ['src/*'] } } }),
    'tsconfig.shared.json': JSON.stringify({ include: ['src/shared/**/*.ts'], exclude: [] }),
  });
  const manifest = {
    BOUNDARIES: { shared: { include: ['src/shared/**/*.ts'], exclude: [], mayImport: ['shared'], packages: [] } },
    ASSET_ROOTS: ['src/assets/'],
    TYPE_PROJECTS: { 'tsconfig.shared.json': { include: ['src/shared/**/*.ts'], exclude: [] } },
  };
  return { root, manifest };
}

// Each case builds a real Git fixture and resolves modules from disk.
describe('dependency boundaries', { timeout: 30_000 }, () => {
  it('accepts local values, types, re-exports and allowed assets with query suffixes', () => {
    const { root, manifest } = fixture("import type { Value } from './value'; export { value } from './value'; import icon from '../assets/icon.svg?inline';");
    expect(checkBoundaries(root, manifest).violations).toEqual([]);
  });

  it.each([
    ["import 'obsidian';", 'package'],
    ["const file = './value'; import(file);", 'computed'],
    ["import fs = require('fs');", 'package'],
    ['/// <reference types="obsidian" />', 'package'],
    ["import type { App } from 'obsidian';", 'package'],
    ["import { readFile } from 'node:fs';", 'package'],
    ["import type { Secret } from '../plugin/service';", 'class'],
    ["export * from '../plugin/service';", 'class'],
    ["const service = import('../plugin/service');", 'class'],
    ["const service = require('../plugin/service');", 'class'],
    ["type Secret = import('../plugin/service').Secret;", 'class'],
    ["import { value } from 'src/shared/value';", 'alias'],
    ["import image from '../../private/icon.svg?raw';", 'asset'],
    ["import { missing } from './missing';", 'unresolved'],
  ])('rejects %s', (source, rule) => {
    const { root, manifest } = fixture(source);
    expect(checkBoundaries(root, manifest).violations.some(message => message.includes(rule))).toBe(true);
  });

  it('rejects a forbidden edge between two explicit classes', () => {
    const { root, manifest } = fixture("import type { Secret } from '../plugin/service';");
    const classes = { ...manifest.BOUNDARIES, isolated: { include: ['src/plugin/**/*.ts'], exclude: [], mayImport: ['isolated'], packages: [] } };
    expect(checkBoundaries(root, { ...manifest, BOUNDARIES: classes }).violations.some(message => message.includes('class'))).toBe(true);
  });

  it('rejects a typecheck project that has dropped a source folder', () => {
    const { root, manifest } = fixture('export const value = 1;');
    writeFileSync(join(root, 'tsconfig.shared.json'), JSON.stringify({ include: [], exclude: [] }));
    expect(checkBoundaries(root, manifest).violations.some(message => message.includes('project'))).toBe(true);
  });
  it('allows deleting an unused shared file before staging the deletion', () => {
    const { root, manifest } = fixture('export const value = 1;');
    rmSync(join(root, 'src/shared/value.ts'));
    expect(checkBoundaries(root, manifest).violations).toEqual([]);
  });

  it('rejects overlapping source classes', () => {
    const { root, manifest } = fixture('export const value = 1;');
    const classes = { ...manifest.BOUNDARIES, isolated: manifest.BOUNDARIES.shared };
    expect(checkBoundaries(root, { ...manifest, BOUNDARIES: classes }).violations.some(message => message.includes('overlap'))).toBe(true);
  });

});

/** The player client lies beside the plugin: `player/src` is browser code that may use shared code only. */
function playerFixture(source: string, files: Record<string, string> = {}) {
  const root = repository({
    'player/src/entry.ts': source,
    'player/src/value.ts': 'export const own = 1;',
    'player/tests/probe.ts': "import 'obsidian'; import 'node:fs';",
    'player/tsconfig.json': JSON.stringify({ include: ['src/**/*.ts'], exclude: ['src/**/*.test.*'] }),
    'src/shared/value.ts': 'export interface Value { x: number }\nexport const value = 1;',
    'src/shared/entry.ts': 'export const entry = 1;',
    'src/plugin/service.ts': 'export interface Secret { private: true }',
    'styles/theme.scss': ':root {}',
    'node_modules/zustand/package.json': JSON.stringify({ name: 'zustand', version: '0.0.0', types: 'index.d.ts' }),
    'node_modules/zustand/index.d.ts': 'export declare const create: number;',
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Node', baseUrl: '.', paths: { 'src/*': ['src/*'] } } }),
    'tsconfig.shared.json': JSON.stringify({ include: ['src/shared/**/*.ts'], exclude: [] }),
    ...files,
  });
  const manifest = {
    BOUNDARIES: {
      shared: { include: ['src/shared/**/*.ts'], exclude: [], mayImport: ['shared'], packages: [] },
      player: { include: ['player/src/**/*.ts'], exclude: ['**/*.test.*'], mayImport: ['shared', 'player'], packages: ['zustand'] },
    },
    SOURCE_ROOTS: ['src/', 'player/src/', 'main.ts'],
    ASSET_ROOTS: ['styles/'],
    TYPE_PROJECTS: {
      'tsconfig.shared.json': { include: ['src/shared/**/*.ts'], exclude: [] },
      'player/tsconfig.json': { include: ['src/**/*.ts'], exclude: ['src/**/*.test.*'] },
    },
  };
  return { root, manifest };
}

describe('dependency boundaries of the player client', { timeout: 30_000 }, () => {
  it('accepts shared code, its own files, an allowed package and a stylesheet in styles/', () => {
    const { root, manifest } = playerFixture([
      "import { value } from '../../src/shared/value';",
      "import type { Value } from '../../src/shared/value';",
      "import { own } from './value';",
      "import { create } from 'zustand';",
      "import '../../styles/theme.scss';",
      'export const used = [value, own, create] as unknown as Value[];',
    ].join('\n'));
    const { violations, counts } = checkBoundaries(root, manifest);
    expect(violations).toEqual([]);
    expect(counts).toMatchObject({ player: 2, shared: 2 });
  });

  it.each([
    ["import type { Secret } from '../../src/plugin/service';", 'class plugin'],
    ["import 'obsidian';", 'package not allowed'],
    ["import { readFileSync } from 'node:fs';", 'package not allowed'],
    ["import { readFileSync } from 'fs';", 'package not allowed'],
    ["import { value } from 'src/shared/value';", 'alias import'],
    ["import { value } from '@/shared/value';", 'alias import'],
    ["import _ from 'lodash';", 'package not allowed'],
    ["const service = import('../../src/plugin/service');", 'class plugin'],
    ["import '../../player/theme.scss';", 'asset outside allowed roots'],
  ])('rejects %s', (source, message) => {
    const { root, manifest } = playerFixture(source);
    expect(checkBoundaries(root, manifest).violations.some(line => line.includes(message) && line.startsWith('player/src/entry.ts:'))).toBe(true);
  });

  it('rejects shared code that imports the player client', () => {
    const { root, manifest } = playerFixture('export const used = 1;', { 'src/shared/entry.ts': "import { own } from '../../player/src/value'; export const entry = own;" });
    const { violations } = checkBoundaries(root, manifest);
    expect(violations.some(line => line.startsWith('src/shared/entry.ts:') && line.includes('class player'))).toBe(true);
  });

  it('leaves the player tests alone, as they are no source of the client', () => {
    const { root, manifest } = playerFixture('export const used = 1;');
    expect(checkBoundaries(root, manifest).violations).toEqual([]);
  });

  it('reads only the source roots the manifest names', () => {
    const { root, manifest } = playerFixture("import 'obsidian';");
    const { SOURCE_ROOTS: _roots, ...withoutRoots } = manifest;
    expect(checkBoundaries(root, withoutRoots).violations).toEqual([]);
    expect(checkBoundaries(root, manifest).violations.length).toBeGreaterThan(0);
  });

  it('rejects a player project that has dropped a source folder', () => {
    const { root, manifest } = playerFixture('export const used = 1;');
    writeFileSync(join(root, 'player/tsconfig.json'), JSON.stringify({ include: [], exclude: [] }));
    expect(checkBoundaries(root, manifest).violations.some(line => line.startsWith('player/tsconfig.json:') && line.includes('project'))).toBe(true);
  });

  it('rejects a player project that is missing', () => {
    const { root, manifest } = playerFixture('export const used = 1;');
    rmSync(join(root, 'player/tsconfig.json'));
    expect(checkBoundaries(root, manifest).violations.some(line => line.startsWith('player/tsconfig.json:'))).toBe(true);
  });
});
