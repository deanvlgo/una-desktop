import { describe, expect, it } from 'vitest';

import manifestFixture from '../fixtures/manifest.doc.json';
import { listSeriesRefs, moveSeriesRef, reorderSeriesRefs, validateManifestInvariants } from './manifest';
import type { CollectionManifestDoc } from './types';

describe('manifest operations', () => {
  const manifestDoc = structuredClone(manifestFixture) as CollectionManifestDoc;

  it('reorders series refs and derives order attrs', () => {
    const next = reorderSeriesRefs(manifestDoc, ['series-b', 'series-a']);
    const refs = listSeriesRefs(next);

    expect(refs.map((ref) => ref.attrs.seriesId)).toEqual(['series-b', 'series-a']);
    expect(refs.map((ref) => ref.attrs.order)).toEqual([1, 2]);
  });

  it('moves series by index', () => {
    const next = moveSeriesRef(manifestDoc, 1, 0);
    const refs = listSeriesRefs(next);

    expect(refs[0].attrs.seriesId).toBe('series-b');
    expect(refs[1].attrs.seriesId).toBe('series-a');
  });

  it('detects duplicate series IDs/doc names', () => {
    const broken = structuredClone(manifestDoc);
    const root = broken.content[0];
    root.content.push(structuredClone(root.content[1]));

    const invariants = validateManifestInvariants(broken);
    expect(invariants.valid).toBe(false);
    expect(invariants.errors.some((error) => error.includes('Duplicate seriesId'))).toBe(true);
  });
});
