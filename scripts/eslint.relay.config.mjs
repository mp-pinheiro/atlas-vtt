// Lint for the relay (npm run lint:relay): the shared base, and no console at all. The relay
// handles secrets, keys, table codes and players' names, and none of them may reach a log.
import { defineConfig } from 'eslint/config';
import { createBaseConfig } from './eslint.base.mjs';

export default defineConfig([
  ...createBaseConfig('relay'),
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-console': 'error' },
  },
]);
