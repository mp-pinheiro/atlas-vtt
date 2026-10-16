import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = new URL('../', import.meta.url);

function legalAssets(): Plugin {
  return {
    name: 'player-legal-assets',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE', source: readFileSync(new URL('LICENSE', root)) });
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync(new URL('THIRD_PARTY_NOTICES.md', root)) });
    },
  };
}
export default defineConfig({
  root: 'player',
  plugins: [react(), legalAssets()],
  base: '/',
  define: {
    'import.meta.env.SOURCE_REVISION': JSON.stringify(process.env.SOURCE_REVISION ?? ''),
    'import.meta.env.SOURCE_URL': JSON.stringify(process.env.SOURCE_URL ?? ''),
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
