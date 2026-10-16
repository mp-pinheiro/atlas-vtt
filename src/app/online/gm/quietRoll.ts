import type { SharedRoll } from '../protocol/index.ts';
import { getDiceCrit } from '../../tools/diceCrit';
import { rollFormula } from '../../tools/diceFormula';
import { parseFormula } from '../../tools/parseFormula';
import type { DiceRules } from '../../types/diceRulesTypes';
import type { RollingDice } from '../../types/diceSetTypes';
import { sharedRoll } from './RollShare.ts';
import { secureRandom } from './secureRandom';


/**
 * A formula rolled by a map's rules (its criticals and exploding dice) without a throw on anyone's
 * screen and without a line in the scene's roll history: for rolls in a message, and private rolls
 * Atlas's own player window must not show. Null for a formula that does not parse or holds no dice.
 */
export function quietRoll(formula: string, rules: DiceRules | RollingDice, id: string, now: number, random: () => number = secureRandom): SharedRoll | null {
  const parsed = parseFormula(formula);
  if (!parsed.ok || !parsed.terms.some((term) => term.kind === 'dice')) return null;
  const { rolls, modifiers, total, linear } = rollFormula(parsed, random, rules);
  return sharedRoll({ id, timestamp: now, formula, rolls, modifiers, total, crit: getDiceCrit(rolls, rules), ...(!linear && { linear: false as const }) });
}
