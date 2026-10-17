import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { atlasAcceptance } from './player/tests/acceptanceCommands.ts';

const pluginAlias = {
  '@': '/src',
  src: '/src',
  obsidian: '/tests/mocks/obsidian.ts',
};

export default defineConfig({
  define: {},
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias: pluginAlias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/setup/obsidianDom.ts', './tests/setup/domHost.ts'],
          exclude: ['**/node_modules/**', '**/*.gpu.test.ts', 'player/**', 'relay/**'],
        },
      },
      {
        extends: true,
        resolve: { alias: pluginAlias },
        optimizeDeps: { include: ['yaml', 'pixi-viewport', 'eventemitter3', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'] },
        test: {
          name: 'gpu',
          setupFiles: ['./tests/setup/domHost.ts'],
          include: ['src/**/*.gpu.test.ts', 'tests/**/*.gpu.test.ts'],
          testTimeout: 600_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'chromium', ignoreDefaultArgs: ['--hide-scrollbars'] } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'player',
          include: ['player/tests/**/*.test.ts', 'player/tests/**/*.test.tsx'],
          exclude: ['player/tests/**/*.browser.test.*'],
          environment: 'node',
        },
      },
      {
        resolve: { dedupe: ['react', 'react-dom'] },
        optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@testing-library/react', '@radix-ui/react-dropdown-menu'] },
        test: {
          name: 'player-browser',
          fileParallelism: false,
          include: ['player/tests/**/*.browser.test.ts', 'player/tests/**/*.browser.test.tsx'],
          browser: {
            commands: { atlasAcceptance },
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'chromium', ignoreDefaultArgs: ['--hide-scrollbars'] } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
