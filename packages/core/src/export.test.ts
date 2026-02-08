import { describe, expect, it } from 'vitest';

import manifestFixture from '../fixtures/manifest.doc.json';
import seriesFixture from '../fixtures/series.deep-hierarchy.doc.json';
import { exportCollection, stripSuggestionArtifacts } from './export';
import { appendSeriesOpSuggestion, createSuggestionBlockNode } from './suggestions';
import type { CollectionManifestDoc, SeriesDoc } from './types';

describe('export pipeline', () => {
  const manifestDoc = structuredClone(manifestFixture) as CollectionManifestDoc;
  const baseSeriesDoc = structuredClone(seriesFixture) as SeriesDoc;

  it('strips suggestion artifacts from series docs', () => {
    const withSuggestions = appendSeriesOpSuggestion(
      baseSeriesDoc,
      createSuggestionBlockNode({
        sid: 'sug-export-1',
        kind: 'SET_FIELD',
        author: 'LLM',
        payload: {
          itemId: 'item-photo-001',
          key: 'takenBy',
          valueType: 'text',
          value: 'Name',
        },
      }),
    );

    const stripped = stripSuggestionArtifacts(withSuggestions);
    const text = JSON.stringify(stripped);

    expect(text.includes('suggestion_block')).toBe(false);
    expect(text.includes('seriesOps')).toBe(false);
  });

  it('exports monolithic collection in manifest order', () => {
    const seriesA: SeriesDoc = {
      type: 'doc',
      content: [
        {
          type: 'series',
          attrs: { id: 'series-a', title: 'Administrative Records' },
          content: [{ type: 'seriesBody', content: [] }],
        },
      ],
    };

    const output = exportCollection({
      manifestDoc,
      seriesDocsByDocName: {
        'series:col-001:series-a': seriesA,
        'series:col-001:series-b': baseSeriesDoc,
      },
    });

    const collection = output.content[0];
    expect(collection.type).toBe('collection');
    expect(collection.content?.[0].attrs?.id).toBe('series-a');
    expect(collection.content?.[1].attrs?.id).toBe('series-b');

    const serialized = JSON.stringify(output);
    expect(serialized.includes('suggestion_block')).toBe(false);
    expect(serialized.includes('suggestion_delete')).toBe(false);
  });
});
