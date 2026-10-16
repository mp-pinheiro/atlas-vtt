import { describe, expect, it, vi, type Mock } from 'vitest';
import { PlayerConditions, playerConditionValues, type ConditionContext, type PlayerCondition } from '../../../../src/app/online/gm/PlayerConditions';
import { token } from './shareHarness';
import { BUILT_IN_SYSTEM_PRESETS } from '../../../../src/app/gameSystems/builtInPresets';

const message: PlayerCondition = { t: 'condition', scene: 'scene', id: 'alias', condition: 'fear', value: 3 };

function fixture(): { handler: PlayerConditions; context: ConditionContext; queued: PlayerCondition[]; refresh: Mock } {
  const context: ConditionContext = {
    scene: 'scene', enabled: true, tokens: { hero: token('hero', { conditions: ['fear'], conditionValues: { fear: 1 } }) },
    conditions: [{ id: 'fear', name: 'Fear', color: '#ffffff', valued: true }],
    listedToken: () => 'hero', ownerOf: () => 'alice', online: () => true,
    setTokensCondition: vi.fn(), changeTokensConditionValue: vi.fn(),
  };
  const queued: PlayerCondition[] = [];
  const refresh = vi.fn();
  const handler = new PlayerConditions({ context: () => context, movementAllowed: () => true, defer: (request) => { queued.push(request.message); return true; }, refresh });
  return { handler, context, queued, refresh };
}

describe('player conditions', () => {
  it('defers an absolute value then computes its delta from current state', () => {
    const { handler, context, queued } = fixture();
    handler.receive('alice', message);
    expect(context.changeTokensConditionValue).not.toHaveBeenCalled();
    const hero = context.tokens.hero!;
    hero.conditionValues = { fear: 2 };
    handler.apply('alice', queued[0]!);
    expect(context.changeTokensConditionValue).toHaveBeenCalledWith(['hero'], 'fear', 1);
    expect(playerConditionValues(context.tokens, new Map([['hero', 'alias']]), context.conditions)).toEqual({ alias: { fear: 2 } });
  });

  it('rechecks ownership after the wait and refreshes without writing', () => {
    const { handler, context, queued, refresh } = fixture();
    handler.receive('alice', message);
    context.ownerOf = () => 'bob';
    handler.apply('alice', queued[0]!);
    expect(context.changeTokensConditionValue).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith('alice');
  });

  it('rejects every explicit sight effect and non-binary ordinary condition', () => {
    const { handler, context } = fixture();
    for (const effect of ['blinded', 'invisible', 'airborne', 'undetected'] as const) {
      context.conditions[0]!.effect = effect;
      handler.receive('alice', message);
    }
    context.conditions[0]!.effect = 'none';
    context.conditions[0]!.valued = false;
    handler.receive('alice', message);
    expect(context.changeTokensConditionValue).not.toHaveBeenCalled();
    expect(context.setTokensCondition).not.toHaveBeenCalled();
  });

  it('rejects inherited built-in effects when the saved definition omitted effect', () => {
    const { context, queued } = fixture();
    const definition = BUILT_IN_SYSTEM_PRESETS.flatMap((preset) => preset.rules.conditions).find((condition) => condition.effect === 'blinded')!;
    const { effect: _effect, ...legacy } = definition;
    const refresh = vi.fn();
    const guarded = new PlayerConditions({ context: () => ({ ...context, conditions: [legacy] }), movementAllowed: () => true, defer: (request) => { queued.push(request.message); return true; }, refresh });
    guarded.receive('alice', { ...message, condition: definition.id, value: 1 });
    expect(queued).toEqual([]);
    expect(refresh).toHaveBeenCalledWith('alice');
  });
});
