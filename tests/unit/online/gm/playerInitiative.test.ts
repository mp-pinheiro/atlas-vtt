import { describe, expect, it, vi, type Mock } from 'vitest';
import { PlayerInitiative, type InitiativeRequest, type PlayerInitiativeContext } from '../../../../src/app/online/gm/PlayerInitiative';
import { PlayerActionRates } from '../../../../src/app/online/gm/PlayerActionRates';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../../../src/app/types/initiativeTypes';
import type { TokenEntity } from '../../../../src/app/types';
import { DEFAULT_INITIATIVE_RULES } from '../../../../src/app/gameSystems/initiativeRules';

function setup(): {
  handler: PlayerInitiative;
  context: PlayerInitiativeContext;
  entry: InitiativeEntry;
  queued: { from: string; message: InitiativeRequest }[];
  roll: Mock;
  next: Mock;
  send: Mock;
  modifier: Mock;
  rolled: Mock;
  turnEnded: Mock;
} {
  const entry: InitiativeEntry = { id: 'private-entry', tokenId: 'private-token', name: 'Hero', initiative: 0, initiativeModifier: 0, imagePath: '', isNPC: false, isActive: true, order: 0, hasInitiative: false };
  const context: PlayerInitiativeContext = {
    scene: 'scene', initiative: { ...createDefaultInitiativeState(), entries: [entry] }, trackerOpen: true,
    rules: DEFAULT_INITIATIVE_RULES, tokens: { 'private-token': { isHidden: false } as TokenEntity },
    listedCombatant: alias => alias === 'alias' ? entry.id : undefined,
    ownerOf: () => 'alice',
  };
  const queued: { from: string; message: InitiativeRequest }[] = [];
  const roll = vi.fn(() => ({ formula: 'd20', rolls: [{ die: 'd20', value: 1, max: 20 }], modifiers: 0, total: 1 }));
  const next = vi.fn();
  const send = vi.fn();
  const modifier = vi.fn(async () => 2);
  const rolled = vi.fn();
  const turnEnded = vi.fn();
  const handler = new PlayerInitiative({
    context: () => context, online: () => true, actionAllowed: () => true, modifier,
    diceAvailable: () => true,
    defer: (from, message) => { queued.push({ from, message }); return true; },
    actions: () => ({ rollEntryInitiative: roll, nextTurn: next }), send, refresh: vi.fn(), rolled, turnEnded,
  });
  return { handler, context, entry, queued, roll, next, send, modifier, rolled, turnEnded };
}

const request: InitiativeRequest = { t: 'initiative-roll', scene: 'scene', combatant: 'alias' };

async function resolveLookup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('player initiative authority', () => {
  it('prepares before combat without drawing and applies one exact roll after deferral', async () => {
    const fixture = setup();
    fixture.handler.receive('alice', request);
    await resolveLookup();
    expect(fixture.queued).toHaveLength(1);
    expect(fixture.roll).not.toHaveBeenCalled();
    fixture.handler.apply('alice', request);
    expect(fixture.roll).toHaveBeenCalledOnce();
    expect(fixture.roll).toHaveBeenCalledWith('private-entry', DEFAULT_INITIATIVE_RULES.roll, 2, { random: expect.any(Function) });
    expect(fixture.rolled).toHaveBeenCalledWith('alice', fixture.entry, fixture.roll.mock.results[0]!.value);
    fixture.handler.apply('alice', request);
    expect(fixture.roll).toHaveBeenCalledOnce();
  });

  it('rejects wrong owners, scenes, aliases, legacy settled zero and sides without lookup', () => {
    const fixture = setup();
    fixture.handler.receive('bob', request);
    fixture.handler.receive('alice', { ...request, scene: 'old' });
    fixture.handler.receive('alice', { ...request, combatant: 'private-entry' });
    delete fixture.entry.hasInitiative;
    fixture.handler.receive('alice', request);
    fixture.entry.hasInitiative = false;
    fixture.context.initiative.sides = { first: 'players', active: 'players' };
    fixture.handler.receive('alice', request);
    expect(fixture.modifier).not.toHaveBeenCalled();
    expect(fixture.send).toHaveBeenCalledTimes(5);
  });

  it('rechecks ownership after async lookup and scene teardown cancels pending work', async () => {
    const fixture = setup();
    fixture.handler.receive('alice', request);
    fixture.context.ownerOf = () => 'bob';
    await resolveLookup();
    expect(fixture.queued).toHaveLength(0);
    fixture.context.ownerOf = () => 'alice';
    fixture.handler.receive('alice', request);
    fixture.handler.sceneChanged();
    await resolveLookup();
    expect(fixture.queued).toHaveLength(0);
    expect(fixture.roll).not.toHaveBeenCalled();
  });

  it('requires round, active identity and one-use authority, with no nextTurn until apply', () => {
    const fixture = setup();
    fixture.context.initiative.isActive = true;
    fixture.context.initiative.currentIndex = 0;
    const turnKey = fixture.handler.turnKey(fixture.context.initiative)!;
    const end: InitiativeRequest = { t: 'end-turn', scene: 'scene', combatant: 'alias', round: fixture.context.initiative.round, turnKey };
    fixture.handler.receive('alice', { ...end, round: end.round + 1 });
    fixture.handler.receive('alice', { ...end, turnKey: '0'.repeat(24) });
    fixture.context.initiative.currentIndex = -1;
    fixture.handler.receive('alice', end);
    fixture.context.initiative.currentIndex = 0;
    fixture.handler.receive('alice', end);
    expect(fixture.queued).toHaveLength(1);
    expect(fixture.next).not.toHaveBeenCalled();
    fixture.handler.apply('alice', end);
    fixture.handler.apply('alice', end);
    expect(fixture.next).toHaveBeenCalledOnce();
    expect(fixture.turnEnded).toHaveBeenCalledOnce();
    const restored = { ...fixture.context.initiative };
    expect(fixture.handler.turnKey(restored)).not.toBe(turnKey);
  });

  it('rechecks hidden state at apply and never calls resource actions', async () => {
    const fixture = setup();
    fixture.handler.receive('alice', request);
    await resolveLookup();
    fixture.context.tokens['private-token']!.isHidden = true;
    fixture.handler.apply('alice', request);
    expect(fixture.roll).not.toHaveBeenCalled();
    expect(fixture.rolled).not.toHaveBeenCalled();
  });
});

describe('table-wide player action rates', () => {
  it('shares one action allowance and one movement allowance across handlers', () => {
    const rates = new PlayerActionRates();
    expect([rates.action('alice', 0), rates.action('alice', 0), rates.action('alice', 0), rates.action('alice', 0)]).toEqual([true, true, true, false]);
    for (let index = 0; index < 8; index++) expect(rates.movement('alice', 0)).toBe(true);
    expect(rates.movement('alice', 0)).toBe(false);
    expect(rates.action('alice', 1000)).toBe(true);
    expect(rates.action('alice', 1000)).toBe(false);
    expect(rates.action('bob', 1000)).toBe(true);
    rates.playerLeft('alice');
    expect(rates.action('alice', 1000)).toBe(true);
  });
});
