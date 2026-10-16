// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const ROOT = path.resolve(__dirname, '../../../src/app/online');
const PLUGIN_ENTRY = path.resolve(__dirname, '../../../src/app/plugin/onlinePlay.ts');
function sources(folder: string): string[] { return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => { const file = path.join(folder, entry.name); if (entry.isDirectory()) return sources(file); return /\.(ts|tsx|scss)$/.test(entry.name) ? [file] : []; }); }
describe('online hosting source', () => {
  const files = [...sources(ROOT), PLUGIN_ENTRY];
  const naming = (pattern: RegExp): string[] => files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => path.relative(ROOT, file)).sort();
  it('reads every online source file', () => { expect(files.length).toBeGreaterThan(150); expect(files.some((file) => file.endsWith('OnlineControl.ts'))).toBe(true); });
  it('keeps the host credential in Obsidian secure storage and uses the configured relay', () => {
    expect(naming(/getSecret\(/)).toEqual(['gm/host/hostKeyStore.ts']);
    expect(naming(/getSecret\(/).includes('gm/OnlineFeature.ts')).toBe(false);
    expect(naming(/Bearer \$\{/)).toEqual(['gm/createTable.ts', 'gm/host/relayAccess.ts']);
    expect(naming(/requestUrl\(/)).toEqual(['gm/companionDiagnostics.ts', 'gm/host/obsidianHttp.ts']);
    expect(readFileSync(path.join(ROOT, 'gm/companionDiagnostics.ts'), 'utf8')).not.toMatch(/Authorization|Bearer|secretStorage/);
  });
  it('does not import Node built-ins', () => {
    expect(naming(/from\s+['"](?:node:|(?:http|https|net|tls|fs|path|url|crypto|child_process|os|stream|zlib|dns|events|buffer|util)['"/])|require\(|import\(\s*['"](?:node:|https?['"])/)).toEqual([]);
  });
  it('uses only host-access and table creation routes', () => {
    const paths = new Set(files.flatMap((file) => readFileSync(file, 'utf8').match(/\/api\/(?:tables|me)[a-z/]*/g) ?? []));
    expect([...paths].sort()).toEqual(['/api/me', '/api/tables', '/api/tables/']);
    expect(naming(/auth\/sign-out|device\/code|account-page/)).toEqual([]);
  });
});
