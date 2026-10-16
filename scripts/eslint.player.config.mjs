// Lint for the player client (npm run lint:player): the shared base plus the limits of browser code.
import { builtinModules } from 'node:module';
import { defineConfig } from 'eslint/config';
import { createBaseConfig } from './eslint.base.mjs';

const nodeNames = builtinModules.map((name) => name.replace(/^node:/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

export default defineConfig([
  ...createBaseConfig('player'),
  {
    // The client's source runs in the player's browser. Obsidian, Electron and Node are not there,
    // and the plugin's `src/` is reached by a relative path (scripts/check-boundaries.mjs holds the rest of the boundary).
    // Its tests run in Node and may use it.
    files: ['**/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: `^(obsidian|electron)(/|$)|^(@codemirror|@lezer)/|^node:|^(?:${nodeNames.join('|')})(/|$)|^(src/|@/)`,
          message: 'The client runs in a browser: it imports shared code by a relative path, and nothing of Obsidian or Node.',
        }],
      }],
    },
  },
  {
    // `console.error` stays for a page that cannot start; everything else is the client's own log or none.
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-console': ['error', { allow: ['error'] }] },
  },
]);
