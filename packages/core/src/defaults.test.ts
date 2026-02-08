import { describe, expect, it } from 'vitest';

import { createDefaultItemFields } from './defaults';

describe('createDefaultItemFields', () => {
  it('creates object defaults with required measurement groups', () => {
    const fieldsNode = createDefaultItemFields('object');

    expect(fieldsNode.type).toBe('itemFields');
    expect(fieldsNode.content?.[0]).toMatchObject({
      type: 'fieldGroup',
      attrs: { groupKey: 'height' },
    });
    expect(fieldsNode.content?.[1]).toMatchObject({
      type: 'fieldGroup',
      attrs: { groupKey: 'weight' },
    });
    expect(fieldsNode.content?.[2]).toMatchObject({
      type: 'field',
      attrs: { key: 'material', value: '' },
    });
  });

  it('uses PRD defaults for photograph materialType and pii', () => {
    const fieldsNode = createDefaultItemFields('photograph');
    const material = fieldsNode.content?.find((node) => node.type === 'field' && node.attrs.key === 'materialType');
    const pii = fieldsNode.content?.find((node) => node.type === 'field' && node.attrs.key === 'pii');

    expect(material).toMatchObject({ attrs: { value: 'other' } });
    expect(pii).toMatchObject({ attrs: { value: false } });
  });
});
