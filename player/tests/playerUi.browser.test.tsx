import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { JoinPanel } from '../src/ui/JoinPanel.tsx';
import { SafeMarkdown } from '../src/ui/SafeMarkdown.tsx';
import { PlayerInput } from '../src/canvas/PlayerInput.ts';
import { createPlayerStore, type PlayerState } from '../src/state/playerStore.ts';
import type { SharedInitiative } from '../../src/app/online/protocol/initiative.ts';
import { InitiativePanel } from '../src/ui/InitiativePanel.tsx';
import { PlayerSettings } from '../src/ui/PlayerSettings.tsx';
import type { AssetDownloads } from '../src/state/interfaces.ts';
import { WidgetBar } from '../src/ui/WidgetBar.tsx';
import { ShownImage } from '../src/ui/ShownImage.tsx';
import { BookTextReader } from '../src/ui/BookTextReader.tsx';
import { NativeSheet } from '../src/ui/NativeSheet.tsx';
import type { SharedSheet } from '../../src/app/online/protocol/sheet.ts';
import type { RollMode } from '../../src/app/online/protocol/chat.ts';
import type { Viewport } from 'pixi-viewport';
import type { PlayerMessage } from '../../src/app/online/protocol/game.ts';
import type { StoreApi } from 'zustand/vanilla';

const noAssets = {} as AssetDownloads;
const activeInputs: PlayerInput[] = [];
afterEach(() => {
  for (const input of activeInputs.splice(0)) input.destroy();
  cleanup();
});
function inputHarness(): {
  readonly input: PlayerInput;
  readonly store: StoreApi<PlayerState>;
  readonly messages: PlayerMessage[];
  readonly canvas: HTMLCanvasElement;
  startProposal(): string;
  allowCancellation(): void;
} {
  const store = createPlayerStore();
  const scene = 'scene-input';
  const tokenId = 'a'.repeat(24);
  const token = { id: tokenId, x: 100, y: 100, size: 70, cells: 1, rotation: 0, art: null, name: 'Alice', ring: null, claim: 'taken' as const, badge: null, ui: null };
  store.getState().beginScene({ id: scene, map: null, lit: false });
  store.getState().setConnection('player', 'Alice', true);
  store.setState((state) => ({
    scene: {
      ...state.scene!,
      covered: false,
      tokens: { t: 'tokens', scene, tokens: [token], cell: 70, snap: null },
      mine: { t: 'mine', scene, tokens: [tokenId] },
      agency: { t: 'agency', scene, permissions: { approval: true, perPlayerVision: false, playerConditions: false, playerDoors: false }, conditions: [], values: {} },
    },
  }));
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => new DOMRect(0, 0, 200, 200) });
  Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
  Object.defineProperty(canvas, 'hasPointerCapture', { value: vi.fn(() => true) });
  Object.defineProperty(canvas, 'releasePointerCapture', { value: vi.fn() });
  const messages: PlayerMessage[] = [];
  let cancellationAllowed = false;
  const input = new PlayerInput(canvas, { toWorld: (x: number, y: number) => ({ x, y }) } as unknown as Viewport, {
    state: () => store.getState(),
    pick: () => tokenId,
    activate: () => false,
    send: (message) => {
      messages.push(message);
      if (message.t === 'path') {
        store.getState().appendFeedback({ scene, request: message.request, status: 'pending', reason: 'path' });
        return true;
      }
      if (message.t === 'path-cancel') {
        if (!cancellationAllowed) return false;
        store.getState().appendFeedback({ scene, request: message.request, status: 'pending', cancelInFlight: true, reason: 'path' });
      }
      return true;
    },
    changed: () => undefined,
    dimensions: () => ({ width: 1400, height: 1400 }),
  });
  input.update(store.getState());
  activeInputs.push(input);
  return {
    input, store, messages, canvas,
    startProposal(): string {
      fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
      const request = input.proposalRequest;
      if (request === null) throw new Error('Pointer input did not create a path proposal');
      return request;
    },
    allowCancellation(): void { cancellationAllowed = true; },
  };
}

describe('map keyboard ownership', () => {
  it('leaves select, menu and dialog keys to their controls without changing a path', () => {
    const { input, store } = inputHarness();
    input.selected = 'a'.repeat(24);
    render(<>
      <select aria-label="Appearance"><option>System</option></select>
      <div role="menu"><div role="menuitem" tabIndex={0}>Public</div></div>
      <div role="dialog"><div tabIndex={-1}>Lantern text</div></div>
    </>);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      for (const target of [screen.getByRole('combobox'), screen.getByRole('menuitem'), screen.getByText('Lantern text')]) {
        fireEvent.keyDown(target, { key: 'ArrowDown' });
        expect(store.getState().proposals).toEqual({});
      }
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(store.getState().proposals['a'.repeat(24)]).toEqual([{ x: 170, y: 100 }]);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('player path cancellation', () => {
  it('preserves the submitted path after a refused send and waits for path-result after queuing cancellation', () => {
    const { input, store, messages, startProposal, allowCancellation } = inputHarness();
    const request = startProposal();
    input.submit();
    input.update(store.getState());
    input.proposalAction('cancel');
    expect(input.proposalRequest).toBe(request);
    expect(store.getState().proposals['a'.repeat(24)]).toBeDefined();
    expect(store.getState().feedback.find((entry) => entry.request === request)?.cancelInFlight).toBeUndefined();
    allowCancellation();
    input.proposalAction('cancel');
    input.update(store.getState());
    expect(input.proposalRequest).toBe(request);
    expect(store.getState().feedback.find((entry) => entry.request === request)?.cancelInFlight).toBe(true);
    input.proposalAction('cancel');
    expect(messages.filter((message) => message.t === 'path-cancel')).toHaveLength(2);
    store.getState().recordAgencyResponse({ t: 'path-result', scene: 'scene-input', id: 'a'.repeat(24), request, result: 'cancelled' });
    input.update(store.getState());
    expect(input.proposalRequest).toBeNull();
    expect(store.getState().proposals['a'.repeat(24)]).toBeUndefined();
  });

  it('discards local path state on transport replacement without replaying a cancellation', () => {
    const { input, store, messages, startProposal } = inputHarness();
    startProposal();
    input.submit();
    input.update(store.getState());
    store.getState().beginTransportGeneration();
    input.update(store.getState());
    expect(messages.filter((message) => message.t === 'path-cancel')).toHaveLength(0);
  });
  it('discards path state on scene replacement without replaying a cancellation', () => {
    const { input, store, messages, startProposal } = inputHarness();
    startProposal();
    input.submit();
    store.getState().beginScene({ id: 'scene-next', map: null, lit: false });
    input.update(store.getState());
    expect(input.proposalRequest).toBeNull();
    expect(messages.filter((message) => message.t === 'path-cancel')).toHaveLength(0);
  });
  it('cancels a local draft on lost focus without cancelling a submitted path', () => {
    const { input, store, messages, startProposal } = inputHarness();
    startProposal();
    window.dispatchEvent(new Event('blur'));
    expect(input.proposalRequest).toBeNull();
    expect(store.getState().proposals['a'.repeat(24)]).toBeUndefined();
    const request = startProposal();
    input.submit();
    input.update(store.getState());
    window.dispatchEvent(new Event('blur'));
    expect(input.proposalRequest).toBe(request);
    expect(store.getState().proposals['a'.repeat(24)]).toBeDefined();
    expect(messages.filter((message) => message.t === 'path-cancel')).toHaveLength(0);
  });

});

describe('player entry and safe text', () => {
  it('does not submit or replace the table from an invalid fragment', () => {
    const onJoin = vi.fn();
    const onTableLink = vi.fn();
    render(<JoinPanel table={null} hasIdentity={false} notice={null} onJoin={onJoin} onForgetIdentity={vi.fn()} onTableLink={onTableLink} />);
    fireEvent.change(screen.getByLabelText('Table link'), { target: { value: 'https://play.example/#javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onJoin).not.toHaveBeenCalled();
    expect(onTableLink).not.toHaveBeenCalled();
  });

  it('uses a saved player identity without asking for a join code', () => {
    const onJoin = vi.fn();
    render(<JoinPanel table="aaaaaaaaaaaaaaaaaaaaaaaaaa" hasIdentity notice={null} onJoin={onJoin} onForgetIdentity={vi.fn()} onTableLink={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.queryByLabelText('Join code')).toBeNull();
    expect(onJoin).toHaveBeenCalledWith({ name: 'Alice' });
  });

  it('never turns raw HTML or an unlisted image URL into active content', () => {
    const { container } = render(<SafeMarkdown text={'<img src=x onerror=alert(1)>\n\n[run](javascript:alert(1))\n\n![secret](https://example.test/picture.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(screen.getByText('secret')).toBeTruthy();
  });
  it('exposes only the owned roll and active end-turn actions', () => {
    const send = vi.fn(() => true);
    const scene = 'scene-1';
    const initiative: SharedInitiative = {
      isActive: true,
      round: 2,
      bySides: false,
      firstSide: 'players',
      activeSide: 'players',
      turnKey: '0123456789abcdef01234567',
      combatants: [
        { id: '111111111111111111111111', own: true, rolled: false, initiative: 0, name: 'Alice', turn: true, sitsOut: false, art: null, ring: null, side: 'players', hp: null },
        { id: '222222222222222222222222', own: false, rolled: false, initiative: 4, name: 'Other', turn: false, sitsOut: false, art: null, ring: null, side: 'opponents', hp: null },
      ],
    };
    render(<InitiativePanel scene={scene} initiative={initiative} gmOnline assets={noAssets} busy={false} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Roll initiative' }));
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(send).toHaveBeenNthCalledWith(1, { t: 'initiative-roll', scene, combatant: '111111111111111111111111' });
    expect(send).toHaveBeenNthCalledWith(2, { t: 'end-turn', scene, round: 2, combatant: '111111111111111111111111', turnKey: initiative.turnKey });
  });

  it('does not expose player initiative actions in sides mode', () => {
    const initiative: SharedInitiative = {
      isActive: true,
      round: 1,
      bySides: true,
      firstSide: 'players',
      activeSide: 'players',
      turnKey: '0123456789abcdef01234567',
      combatants: [{ id: '111111111111111111111111', own: true, rolled: false, initiative: 0, name: 'Alice', turn: true, sitsOut: false, art: null, ring: null, side: 'players', hp: null }],
    };
    render(<InitiativePanel scene="scene-1" initiative={initiative} gmOnline assets={noAssets} busy={false} send={vi.fn(() => true)} />);
    expect(screen.queryByRole('button', { name: 'Roll initiative' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End turn' })).toBeNull();
  });

  it('sends the selected color without changing the displayed roster optimistically', () => {
    const send = vi.fn(() => true);
    render(<PlayerSettings playerId="aaaaaaaaaaaaaaaaaaaa" people={[{ id: 'aaaaaaaaaaaaaaaaaaaa', name: 'Alice' }]} gmOnline busy={false} send={send} />);
    const choices = screen.getAllByRole('button');
    const before = choices.map((choice) => choice.getAttribute('aria-pressed'));
    fireEvent.click(choices[3] as HTMLButtonElement);
    expect(send).toHaveBeenCalledWith({ t: 'colour', colour: 3 });
    expect(choices.map((choice) => choice.getAttribute('aria-pressed'))).toEqual(before);
  });

  it('keeps nested emphasis and external links intact without enabling image URLs', () => {
    const { container } = render(<SafeMarkdown text={'**first and *nested* last** [safe](https://example.test/) after'} />);
    expect(container.querySelector('strong')?.textContent).toBe('first and nested last');
    expect(container.querySelector('strong em')?.textContent).toBe('nested');
    expect(container.querySelector('a')?.rel).toBe('noopener noreferrer');
  });

  it('advances a running widget and replaces it with the paused authoritative value', async () => {
    const running = { scale: 1, widgets: [{ kind: 'timer' as const, label: 'Torch', icon: 'hourglass', colour: null, value: 2, since: 1900 }] };
    const { rerender } = render(<WidgetBar bar={running} />);
    expect(screen.getByText('0:01')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('0:00')).toBeTruthy(), { timeout: 2000 });
    rerender(<WidgetBar bar={{ scale: 1, widgets: [{ ...running.widgets[0]!, value: 120, since: undefined }] }} />);
    expect(screen.getByText('2:00')).toBeTruthy();
    rerender(<WidgetBar bar={null} />);
    expect(screen.queryByText('Torch')).toBeNull();
  });

  it('keeps a shown image locally dismissed until a different shared image arrives', async () => {
    const request = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
    const assets = { request, release: vi.fn() } as unknown as AssetDownloads;
    const image = { hash: 'a'.repeat(64), size: 5, mime: 'image/png' };
    const { rerender } = render(<ShownImage message={{ t: 'shown-image', shown: { id: 'first', image, width: 10, height: 10 } }} assets={assets} />);
    await waitFor(() => expect(screen.getByAltText('Shared image')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ShownImage message={{ t: 'shown-image', shown: { id: 'first', image, width: 10, height: 10 } }} assets={assets} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ShownImage message={{ t: 'shown-image', shown: { id: 'second', image, width: 10, height: 10 } }} assets={assets} />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('retains a found opening when full-text download fails', async () => {
    const assets = { request: vi.fn(async () => { throw new Error('unavailable'); }), release: vi.fn() } as unknown as AssetDownloads;
    render(<BookTextReader title="Found note" opening="Opening survives" text={{ hash: 'a'.repeat(64), size: 3, mime: 'text/plain' }} assets={assets} />);
    expect(screen.getByText('Opening survives')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
  });

  it('selects the GM-indexed native ability in all four roll audiences', async () => {
    const sheet: SharedSheet = {
      revision: 'a'.repeat(24), name: 'Native hero',
      template: { format: 'atlas-statblock-template', version: 1, id: 'sheet', fields: [], layout: { maxColumns: 1, blocks: [{ type: 'rendered-script', id: 'projection', blocks: [{ type: 'text', id: 'ability', text: '+3' }] }] } },
      fields: {}, images: {}, rolls: [{ key: JSON.stringify(['ability', [], 0]), index: 17, formula: '+3', label: 'Strength' }],
    };
    const onRoll = vi.fn((_index: number, _mode: RollMode) => true);
    render(<NativeSheet sheet={sheet} resources={[]} assets={noAssets} onRoll={onRoll} />);
    await page.getByRole('button', { name: 'Strength' }).click();
    expect(onRoll).toHaveBeenLastCalledWith(17, 'public');
    for (const mode of ['GM only', 'Blind', 'Self only']) {
      await page.getByRole('button', { name: 'Roll visibility' }).click();
      await page.getByRole('menuitem', { name: mode, exact: true }).click();
    }
    expect(onRoll.mock.calls.map((call) => call[1])).toEqual(['public', 'gm', 'blind', 'self']);
  });
});
