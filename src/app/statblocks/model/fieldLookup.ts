import type { FieldKey, TemplateField } from './templateTypes';

export function fieldByKey(fields: readonly TemplateField[], key: FieldKey): TemplateField | undefined {
  return fields.find((field) => field.key === key) ?? fields.find((field) => field.formerKeys?.includes(key) === true);
}
