import { describe, expect, it } from 'vitest';

import inlineDeleteParagraph from '../fixtures/suggestion.inline-delete.paragraph.json';
import inlineInsertParagraph from '../fixtures/suggestion.inline-insert.paragraph.json';
import {
  acceptSuggestionDelete,
  acceptSuggestionInsert,
  listInlineSuggestionIds,
  rejectSuggestionDelete,
  rejectSuggestionInsert,
} from './suggestions';

describe('inline suggestion transforms', () => {
  it('accepts insert suggestion by removing mark only', () => {
    const doc = { type: 'doc', content: [structuredClone(inlineInsertParagraph)] };
    const result = acceptSuggestionInsert(doc, 'sug-001');

    const textNode = result.doc.content[0].content?.[1];
    expect(result.changed).toBe(true);
    expect(textNode?.type).toBe('text');
    expect((textNode as any).text).toBe('extensive documentation');
    expect((textNode as any).marks).toBeUndefined();
  });

  it('rejects insert suggestion by removing inserted text', () => {
    const doc = { type: 'doc', content: [structuredClone(inlineInsertParagraph)] };
    const result = rejectSuggestionInsert(doc, 'sug-001');

    const paragraph = result.doc.content[0];
    expect(result.changed).toBe(true);
    expect(paragraph.content).toHaveLength(1);
    expect(paragraph.content?.[0].text).toBe('This series includes ');
  });

  it('accepts delete suggestion by removing delete node', () => {
    const doc = { type: 'doc', content: [structuredClone(inlineDeleteParagraph)] };
    const result = acceptSuggestionDelete(doc, 'sug-002');

    const paragraph = result.doc.content[0];
    expect(result.changed).toBe(true);
    expect(paragraph.content).toHaveLength(1);
    expect(paragraph.content?.[0].text).toBe('Photographs of ');
  });

  it('rejects delete suggestion by restoring text', () => {
    const doc = { type: 'doc', content: [structuredClone(inlineDeleteParagraph)] };
    const result = rejectSuggestionDelete(doc, 'sug-002');

    const paragraph = result.doc.content[0];
    expect(result.changed).toBe(true);
    expect(paragraph.content).toHaveLength(2);
    expect(paragraph.content?.[1].type).toBe('text');
    expect(paragraph.content?.[1].text).toBe('damaged equipment');
  });

  it('lists inline suggestion IDs', () => {
    const insertDoc = { type: 'doc', content: [structuredClone(inlineInsertParagraph)] };
    const insertIds = listInlineSuggestionIds(insertDoc);

    expect(insertIds.insertIds).toEqual(['sug-001']);
    expect(insertIds.deleteIds).toEqual([]);
  });
});
