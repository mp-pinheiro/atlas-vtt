// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const source = ts.createSourceFile('main.tsx', readFileSync(resolve('player/src/main.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imports = source.statements.filter(ts.isImportDeclaration).map((statement) => ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '');

describe('the page\'s entry point', () => {
  it('prepares the host before it imports anything that loads shared code', () => {
    // A module runs after the modules it imports before it, so the host and the language are set first.
    expect(imports[0]).toBe('./host/initializeHost');
  });

  it('brings in the page\'s theme by a relative path', () => {
    expect(imports).toContain('../../styles/player-theme.scss');
  });

  it('draws the root component', () => {
    expect(imports).toContain('./app/Root');
  });
});
