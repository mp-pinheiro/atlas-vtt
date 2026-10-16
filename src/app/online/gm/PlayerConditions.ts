import type { PlayerAgencyMessage } from '../protocol/index.ts';
import type { TokenEntity } from '../../types';
import type { ConditionDefinition } from '../../types/collectionSettingsTypes';
import { conditionEffect } from '../../gameSystems/conditionEffects';
import { conditionValue } from '../../utils/conditionValues';

export type PlayerCondition = Extract<PlayerAgencyMessage, { t: 'condition' }>;

export interface ConditionContext {
  readonly scene: string | null;
  readonly enabled: boolean;
  readonly tokens: Readonly<Record<string, TokenEntity>>;
  readonly conditions: readonly ConditionDefinition[];
  listedToken(from: string, alias: string): string | undefined;
  ownerOf(id: string): string | undefined;
  online(from: string): boolean;
  setTokensCondition(ids: string[], condition: string, active: boolean): void;
  changeTokensConditionValue(ids: string[], condition: string, delta: number): void;
}

export interface PlayerConditionsPorts {
  context(): ConditionContext;
  movementAllowed(from: string): boolean;
  defer(request: { readonly kind: 'condition'; readonly from: string; readonly message: PlayerCondition }): boolean;
  refresh(from: string): void;
}

export class PlayerConditions {
  constructor(private readonly ports: PlayerConditionsPorts) {}

  receive(from: string, message: PlayerCondition): void {
    if (!this.ports.movementAllowed(from)) return this.ports.refresh(from);
    if (!this.allowed(from, message)) return this.ports.refresh(from);
    if (!this.ports.defer(Object.freeze({ kind: 'condition', from, message: Object.freeze({ ...message }) }))) this.ports.refresh(from);
  }

  apply(from: string, message: PlayerCondition): void {
    const checked = this.allowed(from, message);
    if (checked === null) return this.ports.refresh(from);
    const { context, token, id, definition } = checked;
    if (definition.valued) {
      const current = token.conditions?.includes(definition.id) ? conditionValue(token, definition.id) : 0;
      if (current !== message.value) context.changeTokensConditionValue([id], definition.id, message.value - current);
    } else context.setTokensCondition([id], definition.id, message.value === 1);
    this.ports.refresh(from);
  }

  private allowed(from: string, message: PlayerCondition): { context: ConditionContext; token: TokenEntity; id: string; definition: ConditionDefinition } | null {
    const context = this.ports.context();
    if (!context.enabled || context.scene === null || context.scene !== message.scene || !context.online(from)) return null;
    const id = context.listedToken(from, message.id);
    const token = id === undefined ? undefined : context.tokens[id];
    const definition = context.conditions.find((entry) => entry.id === message.condition);
    if (id === undefined || token === undefined || token.isHidden || context.ownerOf(id) !== from || definition === undefined || conditionEffect(definition) !== undefined) return null;
    if (!definition.valued && message.value !== 0 && message.value !== 1) return null;
    return { context, token, id, definition };
  }
}

export function playerConditionValues(tokens: Readonly<Record<string, TokenEntity>>, aliases: ReadonlyMap<string, string>, definitions: readonly ConditionDefinition[]): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [id, alias] of aliases) {
    const token = tokens[id];
    if (token === undefined || token.isHidden) continue;
    const values: Record<string, number> = {};
    for (const definition of definitions) {
      if (conditionEffect(definition) !== undefined) continue;
      values[definition.id] = token.conditions?.includes(definition.id) ? definition.valued ? conditionValue(token, definition.id) : 1 : 0;
    }
    result[alias] = values;
  }
  return result;
}
