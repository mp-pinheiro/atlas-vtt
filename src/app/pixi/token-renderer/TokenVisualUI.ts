import { Container, Graphics, Text, type Ticker } from 'pixi.js';
import type { SharedToken } from '../../online/protocol/tokens';
import { barDimensions } from '../../styles/designTokens';
import { destroyTree } from '../utils/destroyTree';
import { ConditionBadgeRing } from './ConditionBadgeRing';
import { ResourceBarView } from './resources/ResourceBarView';
import { restingTokenUIScale, selectedTokenUIScale } from './tokenSizing';
import { TokenVisual } from './TokenVisual';
import { conditionGlyph } from '../../utils/conditionGlyph';

export interface TokenVisualLayout {
  readonly cellSize: number;
  readonly zoom: number;
  readonly selected: boolean;
  readonly held: boolean;
  readonly hovered?: boolean;
}

export class TokenVisualUI {
  readonly view = new Container({ eventMode: 'none', interactiveChildren: false });
  private readonly below = new Container({ sortableChildren: true });
  private readonly nameBadge = new Graphics({ zIndex: 1 });
  private readonly nameText = new Text({
    text: '',
    style: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial', fontSize: 24, fill: 0xffffff, fontWeight: '600' },
    resolution: 3,
    zIndex: 2,
  });
  private readonly defeated = new Graphics({ zIndex: 30 });
  private readonly conditions = new ConditionBadgeRing();
  private readonly bars: ResourceBarView[] = [];

  constructor(private readonly ticker: Ticker | null = null) {
    this.below.addChild(this.nameBadge, this.nameText, this.defeated);
    this.view.addChild(this.below, this.conditions.container);
  }

  update(token: SharedToken, layout: TokenVisualLayout): void {
    const ui = token.ui;
    this.view.position.set(token.x, token.y);
    this.view.zIndex = layout.selected ? 11 : 10;
    this.view.visible = ui !== null;
    if (!ui) return;
    const resting = restingTokenUIScale(layout.cellSize);
    const scale = layout.selected && !layout.held ? selectedTokenUIScale(resting, layout.zoom) : resting;
    this.below.position.set(0, token.size / 2);
    this.below.scale.set(scale);
    const resolution = Math.min(3 * Math.max(1, resting), 12);
    this.nameText.resolution = resolution;
    this.nameBadge.visible = this.nameText.visible = ui.nameplate && !!token.name;
    if (this.nameBadge.visible) TokenVisual.nameplate(this.nameBadge, this.nameText, token.name!, document.body.classList.contains('theme-dark'));
    while (this.bars.length > ui.bars.length) this.bars.pop()!.destroy();
    this.defeated.clear();
    let top = 2;
    let marked = false;
    ui.bars.forEach((bar, index) => {
      let view = this.bars[index];
      if (!view) {
        view = new ResourceBarView(this.ticker);
        view.view.zIndex = 10;
        this.bars.push(view);
        this.below.addChild(view.view);
      }
      view.setResolution(resolution);
      view.setTextAlpha(layout.selected || layout.hovered ? 1 : 0);
      const height = view.updateVisual(bar, top, this.ticker !== null);
      const spent = bar.direction === 'drains' ? bar.current <= 0 : bar.direction === 'fills' && bar.current >= bar.max;
      if (ui.downed && !marked && bar.defeats && spent) {
        this.defeated.roundRect(-barDimensions.token.width / 2, top, barDimensions.token.width, height, barDimensions.token.radius).fill({ color: 0, alpha: 0.4 });
        marked = true;
      }
      top += height + barDimensions.token.gap;
    });
    const ringRadius = token.ring ? (token.ring.size + token.size) / 4 : token.size / 2;
    this.conditions.update(ui.conditions.map((condition, index) => ({
      id: String(index), name: '', color: Number.parseInt(condition.colour.slice(1), 16),
      glyph: condition.glyph.kind === 'icon' ? conditionGlyph({ name: '?', icon: condition.glyph.icon }) : condition.glyph,
      ...(condition.value !== null && { value: condition.value }),
    })), ringRadius, resting, false);
  }

  destroy(): void {
    for (const bar of this.bars) bar.destroy();
    this.bars.length = 0;
    this.conditions.destroy();
    destroyTree(this.view);
  }
}
