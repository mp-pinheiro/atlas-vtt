// The lint rules the player client (player/) and the relay (relay/) share. Neither is an
// Obsidian plugin, so the `obsidianmd/*` rules that govern the plugin are not loaded; the
// type-aware TypeScript rules, Atlas' own selectors and the house style are. scripts/eslint.player
// .config.mjs and scripts/eslint.relay.config.mjs add what only one of them needs.
//
// Run from the repository root (`npm run lint:player`, `npm run lint:relay`): with `-c`, ESLint
// reads the patterns below relative to the working directory.
import path from 'node:path';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { NO_NATIVE_TITLE } from './lintRules.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..');
const CODE = ['**/*.{ts,tsx}'];
const TESTS = ['**/tests/**', '**/test/**', '**/*.test.{ts,tsx}'];

/** The most lines a file may have, not counting blank lines and comments: CLAUDE.md asks for 200 to 300 and a refactor beyond. */
export const MAX_LINES = 320;

// typescript-eslint's `stylisticTypeChecked` rules that catch mistakes or dead weight. The rest
// (`array-type`, `consistent-type-definitions`, `consistent-indexed-object-style`,
// `consistent-type-assertions`, `class-literal-property-style`, `adjacent-overload-signatures`,
// `ban-tslint-comment`) are matters of taste the repository does not hold to one way.
const STYLISTIC_RULES = [
  '@typescript-eslint/consistent-generic-constructors',
  '@typescript-eslint/dot-notation',
  '@typescript-eslint/no-confusing-non-null-assertion',
  '@typescript-eslint/no-empty-function',
  '@typescript-eslint/no-inferrable-types',
  '@typescript-eslint/non-nullable-type-assertion-style',
  '@typescript-eslint/prefer-find',
  '@typescript-eslint/prefer-for-of',
  '@typescript-eslint/prefer-function-type',
  '@typescript-eslint/prefer-includes',
  '@typescript-eslint/prefer-nullish-coalescing',
  '@typescript-eslint/prefer-optional-chain',
  '@typescript-eslint/prefer-regexp-exec',
  '@typescript-eslint/prefer-string-starts-ends-with',
];

function stylisticRules() {
  const available = tseslint.configs.stylisticTypeChecked.at(-1)?.rules ?? {};
  return Object.fromEntries(STYLISTIC_RULES.map((name) => {
    if (!(name in available)) throw new Error(`typescript-eslint no longer offers ${name} in stylisticTypeChecked`);
    return [name, available[name]];
  }));
}

/**
 * The shared configuration for the code under `folder` ('player' or 'relay').
 * `folder`'s own tsconfig.json files (the nearest one to each file) give the type information.
 */
export function createBaseConfig(folder) {
  return defineConfig([
    globalIgnores(['**/node_modules/', '**/dist/', '**/.wrangler/']),
    {
      files: CODE,
      // ESLint's own recommended rules (`no-debugger`, `no-fallthrough`, `no-self-assign`, ...) come first, as typescript-eslint's
      // typed-linting guide lists them: its presets only switch off the core rules that TypeScript already covers.
      extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: path.join(REPOSITORY, folder),
        },
      },
      linterOptions: {
        // Findings are fixed at their root, never switched off in a comment: a directive is itself a finding.
        noInlineConfig: true,
      },
      rules: {
        ...stylisticRules(),
        'dot-notation': 'off',
        'no-empty-function': 'off',
        '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true }],
        '@typescript-eslint/explicit-function-return-type': ['error', {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        }],
        '@typescript-eslint/no-deprecated': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
        'max-lines': ['error', { max: MAX_LINES, skipBlankLines: true, skipComments: true }],
        'no-restricted-syntax': ['error', ...NO_NATIVE_TITLE],
      },
    },
    {
      // A test lists cases, so its length is no sign of too many jobs in one file.
      files: TESTS,
      rules: { 'max-lines': 'off' },
    },
  ]);
}
