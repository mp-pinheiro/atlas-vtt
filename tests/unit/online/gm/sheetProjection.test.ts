import { describe, expect, it } from 'vitest';
import { projectSheet } from '../../../../src/app/online/gm/book/sheetProjection';
import type { StatblockTemplate } from '../../../../src/app/statblocks/model/templateTypes';

const template: StatblockTemplate = {
  format: 'atlas-statblock-template', version: 1, id: 'vault-native-id',
  fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'portrait', label: 'Portrait', type: 'image' }, { key: 'notes', label: 'Notes', type: 'markdown' }],
  layout: { maxColumns: 1, blocks: [{ type: 'image', id: 'portrait', field: 'portrait', shape: 'portrait' }, { type: 'text', id: 'notes', field: 'notes' }] },
};

describe('remote native sheet projection', () => {
  it('bounds fields, removes vault identity and only authorizes resolved opaque image keys', async () => {
    const result = await projectSheet({
      template, fields: { name: 'Hero', portrait: 'private/Hero.png', notes: '[[private/Secret.md|Label]] ![portrait](private/Hero.png)', invalid: Infinity },
      name: 'Hero', revision: 'a'.repeat(24), templateId: 'opaque',
      image: async (raw) => raw === 'private/Hero.png' ? { ref: { hash: 'b'.repeat(64), size: 1, mime: 'image/png' }, path: raw } : null,
    });
    expect(result).not.toBeNull();
    expect(JSON.stringify(result?.sheet)).not.toContain('private/');
    expect(JSON.stringify(result?.sheet)).not.toContain('vault-native-id');
    expect(result?.sheet.fields.invalid).toBeNull();
    expect(result?.sheet.fields.portrait).toBe('image-0');
    expect(result?.sheet.images['image-0']?.hash).toBe('b'.repeat(64));
    expect(result?.assets.get('b'.repeat(64))).toBe('private/Hero.png');
  });

  it('keeps unresolvable images unavailable instead of emitting their URLs', async () => {
    const result = await projectSheet({ template, fields: { name: 'Hero', portrait: 'https://private.invalid/x.png' }, name: 'Hero', revision: 'a'.repeat(24), templateId: 'opaque', image: async () => null });
    expect(result?.sheet.fields.portrait).toBeNull();
    expect(result?.sheet.images).toEqual({});
    expect(JSON.stringify(result?.sheet)).not.toContain('private.invalid');
  });
});
