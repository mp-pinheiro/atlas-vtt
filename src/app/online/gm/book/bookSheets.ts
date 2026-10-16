import type { TokenEntity } from '../../../types';
import type { SharedSheet } from '../../protocol/index';
import type { SheetProjection } from './sheetProjection';

interface HeldSheet {
  readonly source: string;
  readonly sheet: SharedSheet | null;
  readonly assets: ReadonlyMap<string, string>;
  readonly signature: string;
}

export class BookSheets {
  private readonly held = new Map<string, HeldSheet>();
  private readonly pending = new Map<string, { readonly source: string }>();
  private generation = 0;

  constructor(private readonly ports: {
    read(token: TokenEntity): Promise<SheetProjection | null>;
    current(token: TokenEntity, scope: string): boolean;
    randomId(): string;
    changed(): void;
  }) {}

  get(token: TokenEntity, scope: string): SharedSheet | null {
    const source = JSON.stringify([scope, 'statblockPath' in token ? token.statblockPath : '']);
    const key = token.id;
    const held = this.held.get(key);
    if (this.pending.get(key)?.source !== source) {
      const ticket = { source };
      const generation = this.generation;
      this.pending.set(key, ticket);
      void this.ports.read(token).then((projection) => {
        if (generation !== this.generation || this.pending.get(key) !== ticket) return;
        this.pending.delete(key);
        if (!this.ports.current(token, scope)) { this.ports.changed(); return; }
        const signature = JSON.stringify(projection === null ? null : { sheet: { ...projection.sheet, revision: '' }, context: projection.context });
        const before = this.held.get(key);
        if (before?.source === source && before.signature === signature) return;
        this.held.set(key, { source, signature, sheet: projection === null ? null : { ...projection.sheet, revision: this.ports.randomId() }, assets: projection?.assets ?? new Map() });
        this.ports.changed();
      }, () => {
        if (generation !== this.generation || this.pending.get(key) !== ticket) return;
        this.pending.delete(key);
        if (!this.ports.current(token, scope)) { this.ports.changed(); return; }
        if (this.held.get(key)?.sheet === null) return;
        this.held.set(key, { source, signature: 'null', sheet: null, assets: new Map() });
        this.ports.changed();
      });
    }
    return held?.source === source ? held.sheet : null;
  }

  asset(tokenId: string, sheet: SharedSheet, hash: string): string | undefined {
    const held = this.held.get(tokenId);
    return held?.sheet?.revision === sheet.revision && Object.values(sheet.images).some((ref) => ref.hash === hash) ? held.assets.get(hash) : undefined;
  }

  stop(): void {
    this.generation++;
    this.pending.clear();
    this.held.clear();
  }
}
