import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { TEST_HOST_KEY } from './test/fixtures/hostKey.ts';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // The player client's build does not exist in a clean clone: the tests serve a fixture folder in its place.
        // The path is relative to this file, as the plugin resolves Miniflare's paths against the project's folder.
        assets: { directory: './test/fixtures/assets', binding: 'ASSETS' },
        bindings: { HOST_KEY: TEST_HOST_KEY },
      },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
});
