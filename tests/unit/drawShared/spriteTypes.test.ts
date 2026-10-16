import fs from 'node:fs';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as SpriteTypes from '../../../src/app/pixi/token-renderer/spriteTypes';
import type * as RendererTypes from '../../../src/app/pixi/token-renderer/types';

const DIRECTORY = 'src/app/pixi/token-renderer';

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** The names a file declares as exported interfaces. */
function interfacesOf(source: ts.SourceFile): string[] {
  return source.statements
    .filter((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    .map((node) => node.name.text);
}

/** The imports of a file: module specifier to the names it takes. */
function importsOf(source: ts.SourceFile): Map<string, string[]> {
  const imports = new Map<string, string[]>();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const bindings = node.importClause?.namedBindings;
    imports.set(node.moduleSpecifier.text, bindings && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : []);
  }
  return imports;
}

describe('token-renderer/types.ts and spriteTypes.ts', () => {
  it('still offer the token group and the sprite factory under their old names, as the same types', () => {
    expectTypeOf<RendererTypes.TokenGroupContainer>().toEqualTypeOf<SpriteTypes.TokenGroupContainer>();
    expectTypeOf<RendererTypes.ITokenSpriteFactory>().toEqualTypeOf<SpriteTypes.ITokenSpriteFactory>();
    expectTypeOf<ReturnType<RendererTypes.ITokenSpriteFactory['createTokenSprite']>>().toEqualTypeOf<Promise<RendererTypes.TokenGroupContainer>>();
  });

  it('re-export both from the one place the declarations moved to', () => {
    const types = parse(`${DIRECTORY}/types.ts`);
    const reexports = types.statements.filter((node): node is ts.ExportDeclaration => ts.isExportDeclaration(node) && !!node.moduleSpecifier);
    const names = reexports.flatMap((node) => (node.moduleSpecifier as ts.StringLiteral).text === './spriteTypes' && node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map((element) => element.name.text)
      : []);
    expect(names.sort()).toEqual(['ITokenSpriteFactory', 'TokenGroupContainer']);
    expect(reexports.every((node) => node.isTypeOnly)).toBe(true);
    expect(interfacesOf(types)).not.toContain('TokenGroupContainer');
    expect(interfacesOf(types)).not.toContain('ITokenSpriteFactory');
    expect(interfacesOf(parse(`${DIRECTORY}/spriteTypes.ts`))).toEqual(['TokenGroupContainer', 'ITokenSpriteFactory']);
  });

  it('keep the plugin\'s token UI out of the declarations the drawing code imports', () => {
    const imports = importsOf(parse(`${DIRECTORY}/spriteTypes.ts`));
    expect([...imports.keys()].sort()).toEqual(['../../types', 'pixi.js']);
  });

  it.each(['SpriteFactory', 'tokenArtwork', 'DownedTokenOverlay', 'InstanceBadge'])('lets %s take the group from spriteTypes', (name) => {
    const imports = importsOf(parse(`${DIRECTORY}/${name}.ts`));
    expect(imports.get('./spriteTypes')).toContain('TokenGroupContainer');
    expect(imports.has('./types')).toBe(false);
  });
});
