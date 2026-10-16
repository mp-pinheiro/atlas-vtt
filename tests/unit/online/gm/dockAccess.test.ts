import { describe, expect, it, vi } from 'vitest';
import { renderMenu, type MenuActions } from '../../../../src/app/online/gm/dock/ConnectionMenu.ts';
import { menuModel, type OnlineSnapshot, type SceneFacts } from '../../../../src/app/online/gm/dock/panelModel.ts';
const SCENE: SceneFacts = { isShared: true, tokens: {}, selected: [] };
const snapshot = (over: Partial<OnlineSnapshot> = {}): OnlineSnapshot => ({ status: 'idle', link: null, sharedLeaf: null, sharedName: null, sharedTokens: {}, players: [], playerTokens: [], seats: null, gate: null, ...over });
function actions(): MenuActions { return { start: vi.fn(), retry: vi.fn(), newCode: vi.fn(), setRequireCode: vi.fn(), setAskToJoin: vi.fn(), copyCode: vi.fn(async () => true), hideImage: vi.fn(), stop: vi.fn(), share: vi.fn(), copy: vi.fn(async () => true), toggleQr: vi.fn() }; }
describe('online host menu', () => {
  it('keeps hosting disabled without a locally stored host key', () => {
    const layer = document.body.createDiv();
    renderMenu(layer, menuModel(snapshot(), SCENE, 'unconfigured'), actions());
    expect(layer.textContent).toContain('Host key is not configured.');
    expect([...layer.querySelectorAll('button')].find((button) => button.textContent === 'Start online table')?.disabled).toBe(true);
  });
  it('allows the explicit create action when a key is stored without checking the relay on open', () => {
    const layer = document.body.createDiv();
    renderMenu(layer, menuModel(snapshot(), SCENE, 'unconfigured', false, true), actions());
    expect(layer.textContent).toContain('A host key is stored; starting a table checks access.');
    expect([...layer.querySelectorAll('button')].find((button) => button.textContent === 'Start online table')?.disabled).toBe(false);
  });
  it('enables hosting after a successful explicit relay check', () => {
    const layer = document.body.createDiv();
    renderMenu(layer, menuModel(snapshot(), SCENE, 'ready', false, true), actions());
    expect([...layer.querySelectorAll('button')].find((button) => button.textContent === 'Start online table')?.disabled).toBe(false);
  });
});
