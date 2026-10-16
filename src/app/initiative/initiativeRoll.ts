import { parseFormula } from '../tools/parseFormula';
import { rollFormula, type RolledDie } from '../tools/diceFormula';

export interface InitiativeRollResult {
  readonly formula: string;
  readonly rolls: RolledDie[];
  readonly modifiers: number;
  readonly total: number;
}

export interface InitiativeRollOptions {
  readonly random?: () => number;
}

export function rollInitiative(roll: string, modifier: number, random: () => number): InitiativeRollResult | null {
  const parsed = parseFormula(roll);
  if (!parsed.ok || !Number.isFinite(modifier)) return null;
  const result = rollFormula(parsed, random);
  return { formula: modifier === 0 ? roll : `(${roll})${modifier < 0 ? '' : '+'}${modifier}`, rolls: result.rolls, modifiers: result.modifiers + modifier, total: result.total + modifier };
}
