import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The commit the page is built from: the CI's, else the checkout's, else `dev`. */
function buildId(): string {
  const commit = process.env.GITHUB_SHA;
  if (commit) return commit.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}

// The player client: a static page the relay serves. It imports shared code by relative path, so
// there are no aliases (the boundary check rejects them).
export default defineConfig({
  root: path.resolve(__dirname, 'player'),
  base: '/',
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {
        // Suppress deprecation warnings, as the plugin's build does.
        quietDeps: true,
        silenceDeprecations: ['import', 'legacy-js-api'],
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    __ATLAS_ONLINE_BUILD__: JSON.stringify(buildId()),
  },
});
