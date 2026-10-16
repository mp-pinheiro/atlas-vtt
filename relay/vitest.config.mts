import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) },
    miniflare: { bindings: { HOST_KEY: 'atlas-vtt-local-test-host-key' } },
  })],
  test: {
    include: ['relay/tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
