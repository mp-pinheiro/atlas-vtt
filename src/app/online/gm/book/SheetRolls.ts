import type { GmMessage, PlayerSheetMessage, SharedSheet } from '../../protocol/index.ts';
import type { DiceSource } from '../atlasDice';
import type { DiceRollResult } from '../../../types/diceTypes';
import type { DiceRules } from '../../../types/diceRulesTypes';
import type { DiceSet, RollingDice } from '../../../types/diceSetTypes';
import { rollDiceFormula, rollingWith } from '../../../tools/DiceTool';
import { secureRandom } from '../secureRandom';
import { sharedRoll, type RollNotes } from '../RollShare';
import { rollAudience } from '../PlayerRolls';
import type { LoggedRoll } from '../log/TableLog';

export interface SheetAuthority {
  readonly sheet: SharedSheet;
  readonly character: string;
  readonly scene: string;
  readonly mapPath: string;
  readonly tokenId: string;
  readonly tokenAlias: string;
  readonly sourcePath: string;
  readonly set: DiceSet | undefined;
  readonly rules: DiceRules | RollingDice;
}

export interface SheetRollsPorts {
  current(from: string): SheetAuthority | null;
  dice(): DiceSource | null;
  actionAllowed(from: string): boolean;
  defer(request: { readonly kind: 'sheet-roll'; readonly from: string; readonly message: PlayerSheetMessage }): boolean;
  send(message: GmMessage, to: string): void;
  refresh(from: string): void;
  rollAs(from: string, run: () => void, notes: RollNotes): void;
  logged(roll: LoggedRoll): void;
  randomId(): string;
  random?: () => number;
}

export class SheetRolls {
  constructor(private readonly ports: SheetRollsPorts) {}

  receive(from: string, message: PlayerSheetMessage): void {
    if (!this.ports.actionAllowed(from)) return this.refuse(from, 'rate');
    const checked = this.checked(from, message);
    if (typeof checked === 'string') return this.refuse(from, checked);
    if (!this.ports.defer(Object.freeze({ kind: 'sheet-roll', from, message: Object.freeze({ ...message }) }))) this.refuse(from, 'unavailable');
  }

  apply(from: string, message: PlayerSheetMessage): void {
    const authority = this.checked(from, message);
    const dice = this.ports.dice();
    if (typeof authority === 'string') return this.refuse(from, authority);
    if (dice === null) return this.refuse(from, 'unavailable');
    const spec = authority.sheet.rolls.find((roll) => roll.index === message.index);
    if (spec === undefined) return this.refuse(from, 'unavailable');
    const source: NonNullable<DiceRollResult['source']> = { type: 'statblock', statblockPath: authority.sourcePath, tokenId: authority.tokenId, tokenName: authority.sheet.name, abilityName: spec.label };
    const notes = { flavor: spec.label };
    const random = this.ports.random ?? secureRandom;
    if (message.mode === 'public') {
      let result: DiceRollResult | null = null;
      this.ports.rollAs(from, () => {
        result = dice.rollDice(spec.formula, source, { viewId: dice.viewId, mapPath: authority.mapPath, tokenId: authority.tokenId }, { random, ...(authority.set && { set: authority.set }) });
      }, notes);
      if (result === null) this.refuse(from, 'unavailable');
      return;
    }
    const rolling = rollingWith(authority.rules, authority.set);
    let rejected = false;
    const result = rollDiceFormula(spec.formula, rolling.rules, { random, rollId: () => this.ports.randomId(), roller: () => from, onFormulaError: () => { rejected = true; } }, rolling.shown);
    if (result === null || rejected) return this.refuse(from, 'unavailable');
    result.source = source;
    const roll = sharedRoll(result);
    this.ports.logged({ who: from, roll, token: authority.tokenAlias, shared: true, mode: message.mode, to: rollAudience(message.mode, from), ...notes });
    if (message.mode !== 'blind') this.ports.send({ t: 'roll', who: from, result: roll, token: authority.tokenAlias }, from);
  }

  private checked(from: string, message: PlayerSheetMessage): SheetAuthority | 'scene' | 'unavailable' {
    const authority = this.ports.current(from);
    if (authority === null) return 'scene';
    return authority.sheet.revision === message.sheet && authority.sheet.rolls.some((roll) => roll.index === message.index) ? authority : 'unavailable';
  }

  private refuse(from: string, reason: 'rate' | 'scene' | 'unavailable'): void {
    this.ports.send({ t: 'roll-refused', reason }, from);
    if (reason !== 'rate') this.ports.refresh(from);
  }
}
