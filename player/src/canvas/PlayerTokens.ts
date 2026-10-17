import { Container, Sprite, Texture, type Ticker } from 'pixi.js';
import type { AssetRef } from '../../../src/app/online/protocol/asset';
import type { SharedToken } from '../../../src/app/online/protocol/tokens';
import { TokenVisual, type TokenArtworkView } from '../../../src/app/pixi/token-renderer/TokenVisual';
import { TokenVisualUI } from '../../../src/app/pixi/token-renderer/TokenVisualUI';
import { DownedTokenOverlay } from '../../../src/app/pixi/token-renderer/DownedTokenOverlay';
import { updateInstanceBadge, removeInstanceBadge } from '../../../src/app/pixi/token-renderer/InstanceBadge';
import { loadedTokenRingTexture, loadTokenRingTexture } from '../../../src/app/pixi/token-renderer/tokenRingTexture';
import { computeTokenStrokeWidth } from '../../../src/app/pixi/token-renderer/tokenSizing';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree';

export interface PlayerTokensOptions {
  acquire(ref: AssetRef): Promise<Texture>;
  release(ref: AssetRef): void;
  changed(): void;
  readonly ticker?: Ticker;
}

export interface PlayerTokenLayout {
  readonly cellSize: number;
  readonly zoom: number;
  readonly selected?: ReadonlySet<string>;
  readonly held?: ReadonlySet<string>;
  readonly hovered?: string | null;
  readonly visible?: (token: SharedToken) => boolean;
}

interface ArtLoad {
  readonly ref: AssetRef;
  ready: boolean;
  active: boolean;
}

interface TokenView {
  readonly art: TokenArtworkView;
  readonly ui: TokenVisualUI;
  token: SharedToken;
  load: ArtLoad | null;
  ringKey: string;
}

export class PlayerTokens {
  readonly view = new Container({ label: 'player-tokens', sortableChildren: true });
  readonly ui = new Container({ label: 'player-token-ui', sortableChildren: true });
  private readonly tokens = new Map<string, TokenView>();
  private readonly downed: DownedTokenOverlay;
  private order: readonly SharedToken[] = [];
  private stopped = false;

  constructor(private readonly options: PlayerTokensOptions) {
    this.downed = new DownedTokenOverlay(() => options.changed(), () => options.ticker ?? null);
    void loadTokenRingTexture().then(() => {
      if (this.stopped) return;
      for (const token of this.tokens.values()) {
        token.ringKey = '';
        this.updateRing(token);
        this.downed.refresh(token.art);
      }
      options.changed();
    });
  }

  update(tokens: readonly SharedToken[], layout: PlayerTokenLayout): void {
    if (this.stopped) return;
    this.order = tokens;
    const present = new Set(tokens.map(({ id }) => id));
    for (const [id, view] of this.tokens) {
      if (present.has(id)) continue;
      this.remove(view);
      this.tokens.delete(id);
    }
    tokens.forEach((token, index) => {
      let entry = this.tokens.get(token.id);
      const created = !entry;
      if (!entry) {
        const art = Object.assign(TokenVisual.create(Texture.EMPTY, token.size), {
          tokenSize: token.size, strokeWidth: computeTokenStrokeWidth(layout.cellSize), tokenData: { showRing: token.ring !== null },
        });
        entry = { art, ui: new TokenVisualUI(this.options.ticker ?? null), token, load: null, ringKey: '' };
        this.tokens.set(token.id, entry);
        this.view.addChild(art);
        this.ui.addChild(entry.ui.view);
      }
      const previousArt = entry.token.art;
      entry.token = token;
      entry.art.tokenData.showRing = token.ring !== null;
      const stroke = token.ring ? Math.max(0, (token.ring.size - token.size) / 2) : computeTokenStrokeWidth(layout.cellSize);
      if (entry.art.tokenSize !== token.size || entry.art.strokeWidth !== stroke) TokenVisual.resize(entry.art, token.size, stroke);
      entry.art.position.set(token.x, token.y);
      entry.art.zIndex = index;
      TokenVisual.rotation(entry.art, token.rotation);
      this.updateRing(entry);
      const sameArt = previousArt?.hash === token.art?.hash && previousArt?.size === token.art?.size && previousArt?.mime === token.art?.mime;
      if (!sameArt || (!entry.load && token.art)) this.loadArt(entry, token.art);
      entry.ui.update(token, {
        cellSize: layout.cellSize, zoom: layout.zoom,
        selected: layout.selected?.has(token.id) ?? false, held: layout.held?.has(token.id) ?? false, hovered: layout.hovered === token.id,
      });
      this.downed.update(entry.art, token.ui?.downed ?? false, !created);
      const shown = layout.visible?.(token) ?? true;
      entry.art.visible = shown;
      entry.ui.view.visible = shown && token.ui !== null;
      if (token.badge === null) removeInstanceBadge(entry.art);
      else updateInstanceBadge(entry.art, token.badge, token.size, true);
    });
    this.options.changed();
  }

  hitTest(x: number, y: number): string | null {
    if (this.stopped || !this.view.visible) return null;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const token = this.order[i];
      if (token === undefined) continue;
      const entry = this.tokens.get(token.id);
      if (!entry?.art.visible) continue;
      if (token.ring) {
        if (Math.hypot(x - token.x, y - token.y) <= token.ring.size / 2) return token.id;
      } else {
        const sprite = entry.art.getChildByLabel('tokenSprite') as Sprite | null;
        if (!sprite) continue;
        const dx = x - token.x;
        const dy = y - token.y;
        const angle = token.rotation * Math.PI / 180;
        const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
        const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
        if (Math.abs(localX) <= sprite.width / 2 && Math.abs(localY) <= sprite.height / 2) return token.id;
      }
    }
    return null;
  }

  private updateRing(entry: TokenView): void {
    const { ring, size } = entry.token;
    const key = `${ring?.colour}:${ring?.size}:${size}`;
    if (entry.ringKey === key) return;
    entry.ringKey = key;
    TokenVisual.ring(entry.art, ring?.colour ?? null, loadedTokenRingTexture(), undefined, ring?.size);
  }

  private loadArt(entry: TokenView, ref: AssetRef | null): void {
    this.releaseArt(entry);
    const sprite = entry.art.getChildByLabel('tokenSprite') as Sprite | null;
    if (sprite) sprite.texture = Texture.EMPTY;
    if (!ref) return;
    const load: ArtLoad = { ref, ready: false, active: true };
    entry.load = load;
    void this.options.acquire(ref).then((texture) => {
      load.ready = true;
      if (!load.active || this.stopped) {
        this.options.release(ref);
        return;
      }
      const art = entry.art.getChildByLabel('tokenSprite') as Sprite | null;
      if (art) art.texture = texture;
      TokenVisual.artwork(entry.art, entry.token.size, entry.token.ring !== null);
      this.options.changed();
    }).catch(() => {
      if (!load.active || this.stopped) return;
      entry.art.label = 'token-art-unavailable';
      this.options.changed();
    });
  }

  private releaseArt(entry: TokenView): void {
    const load = entry.load;
    entry.load = null;
    if (!load) return;
    load.active = false;
    if (load.ready) this.options.release(load.ref);
  }

  private remove(entry: TokenView): void {
    this.releaseArt(entry);
    this.downed.release(entry.art);
    entry.ui.destroy();
    destroyTree(entry.art);
  }

  destroy(): void {
    this.stopped = true;
    for (const entry of this.tokens.values()) this.remove(entry);
    this.tokens.clear();
    this.order = [];
    this.downed.destroy();
    destroyTree(this.view);
    destroyTree(this.ui);
  }
}
