import { isRecord } from './shape.ts';

export type WireReader = (value: unknown) => unknown;
export type WireRules = Readonly<Record<string, WireReader>>;

export function wireText(max: number, nonempty = false): WireReader {
  return (value: unknown): string | undefined => typeof value === 'string' && value.length <= max && (!nonempty || value.length > 0) ? value : undefined;
}

export function wireEnum<T extends string | number | boolean>(...options: readonly T[]): WireReader {
  return (value: unknown): T | undefined => options.find((option) => option === value);
}

export const wireBoolean: WireReader = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
export const wireNumber: WireReader = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const wirePositive: WireReader = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
export const wirePositiveInteger: WireReader = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

export function wireArray(reader: WireReader, maximum = 200, minimum = 0): WireReader {
  return (value: unknown): unknown[] | undefined => {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return undefined;
    const result: unknown[] = [];
    for (const item of value) {
      const next = reader(item);
      if (next === undefined) return undefined;
      result.push(next);
    }
    return result;
  };
}

export function wireDictionary(reader: WireReader, maximum = 200): WireReader {
  return (value: unknown): Record<string, unknown> | undefined => {
    if (!isRecord(value) || Object.keys(value).length > maximum) return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.length === 0 || key.length > 200 || key in Object.prototype) return undefined;
      const next = reader(item);
      if (next === undefined) return undefined;
      result[key] = next;
    }
    return result;
  };
}

export function wireShape<T extends object>(value: unknown, rules: WireRules, required: readonly string[]): T | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of required) if (!Object.hasOwn(value, key)) return undefined;
  for (const [key, reader] of Object.entries(rules)) {
    if (!Object.hasOwn(value, key)) continue;
    const parsed = reader(value[key]);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }
  return result as T;
}

export function wireShapeReader(rules: WireRules, required: readonly string[] = []): WireReader {
  return (value: unknown): Record<string, unknown> | undefined => wireShape(value, rules, required);
}
