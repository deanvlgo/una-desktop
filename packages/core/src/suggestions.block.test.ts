import { describe, expect, it } from 'vitest';

import seriesFixture from '../fixtures/series.deep-hierarchy.doc.json';
import {
  acceptSuggestionBlock,
  acceptSuggestionGroup,
  appendSeriesOpSuggestion,
  createSuggestionBlockNode,
  listBlockSuggestions,
  rejectSuggestionBlock,
} from './suggestions';
import type { SeriesDoc } from './types';

describe('block suggestion transforms', () => {
  it('applies CREATE_ITEM and removes suggestion', () => {
    const sid = 'sug-create-001';
    let doc = appendSeriesOpSuggestion(
      structuredClone(seriesFixture) as SeriesDoc,
      createSuggestionBlockNode({
        sid,
        kind: 'CREATE_ITEM',
        author: 'LLM',
        payload: {
          parentFileId: 'file-b1-1',
          itemType: 'photograph',
          initialFields: { subjects: ['New subject'] },
        },
      }),
    );

    const beforeItems = (((doc.content[0].content?.[2] as any).content?.[0] as any).content ?? []) as any[];
    expect(beforeItems).toHaveLength(1);

    const applied = acceptSuggestionBlock(doc, sid);
    doc = applied.doc;

    const afterItems = (((doc.content[0].content?.[2] as any).content?.[0] as any).content ?? []) as any[];
    expect(applied.status).toBe('applied');
    expect(afterItems).toHaveLength(2);

    const suggestions = listBlockSuggestions(doc);
    expect(suggestions.find((entry) => entry.sid === sid)).toBeUndefined();
  });

  it('applies SET_FIELD by creating missing field', () => {
    const sid = 'sug-setfield-001';
    const doc = appendSeriesOpSuggestion(
      structuredClone(seriesFixture) as SeriesDoc,
      createSuggestionBlockNode({
        sid,
        kind: 'SET_FIELD',
        author: 'LLM',
        payload: {
          itemId: 'item-photo-001',
          key: 'takenBy',
          valueType: 'text',
          value: 'Staff Photographer',
        },
      }),
    );

    const applied = acceptSuggestionBlock(doc, sid);
    expect(applied.status).toBe('applied');

    const itemFields = (((((applied.doc.content[0].content?.[2] as any).content?.[0] as any).content?.[0] as any)
      .content?.[0]) as any);
    const field = (itemFields.content as any[]).find((entry) => entry.type === 'field' && entry.attrs.key === 'takenBy');

    expect(field).toBeDefined();
    expect(field.attrs.value).toBe('Staff Photographer');
  });

  it('marks invalid REORDER_SIBLING as stale', () => {
    const sid = 'sug-reorder-001';
    const doc = appendSeriesOpSuggestion(
      structuredClone(seriesFixture) as SeriesDoc,
      createSuggestionBlockNode({
        sid,
        kind: 'REORDER_SIBLING',
        author: 'LLM',
        payload: {
          parentId: 'file-b1-1',
          nodeId: 'item-photo-999',
          targetSiblingId: 'item-photo-001',
          placement: 'before',
        },
      }),
    );

    const applied = acceptSuggestionBlock(doc, sid);
    expect(applied.status).toBe('stale');

    const suggestions = listBlockSuggestions(applied.doc);
    const stale = suggestions.find((entry) => entry.sid === sid);
    expect(stale?.stale).toBe(true);
  });

  it('accepts/rejects suggestions by group', () => {
    let doc = appendSeriesOpSuggestion(
      structuredClone(seriesFixture) as SeriesDoc,
      createSuggestionBlockNode({
        sid: 'sug-group-1',
        groupId: 'group-1',
        kind: 'SET_FIELD',
        author: 'LLM',
        payload: {
          itemId: 'item-photo-001',
          key: 'takenBy',
          valueType: 'text',
          value: 'Photographer A',
        },
      }),
    );

    doc = appendSeriesOpSuggestion(
      doc,
      createSuggestionBlockNode({
        sid: 'sug-group-2',
        groupId: 'group-1',
        kind: 'SET_FIELD',
        author: 'LLM',
        payload: {
          itemId: 'item-photo-001',
          key: 'materialType',
          valueType: 'select',
          value: 'digital',
        },
      }),
    );

    const accepted = acceptSuggestionGroup(doc, 'group-1');
    expect(accepted.applied).toHaveLength(2);

    const rejectResult = rejectSuggestionBlock(accepted.doc, 'sug-group-1');
    expect(rejectResult.status).toBe('noop');
  });

  it('is deterministic for concurrent CREATE_ITEM accepts', () => {
    const sid = 'sug-concurrent-1';
    const start = appendSeriesOpSuggestion(
      structuredClone(seriesFixture) as SeriesDoc,
      createSuggestionBlockNode({
        sid,
        kind: 'CREATE_ITEM',
        author: 'LLM',
        payload: {
          parentFileId: 'file-b1-1',
          itemType: 'photograph',
          initialFields: { date: '1930' },
        },
      }),
    );

    const resultA = acceptSuggestionBlock(start, sid).doc;
    const resultB = acceptSuggestionBlock(start, sid).doc;

    expect(resultA).toEqual(resultB);
  });
});
