import { describe, expect, it } from 'vitest';

import manifestFixture from '../fixtures/manifest.doc.json';
import seriesFixture from '../fixtures/series.deep-hierarchy.doc.json';
import { validateArchivalDoc } from './schema';

describe('schema validation', () => {
  it('validates manifest fixture', () => {
    const result = validateArchivalDoc(manifestFixture);
    expect(result.valid).toBe(true);
  });

  it('validates series fixture', () => {
    const result = validateArchivalDoc(seriesFixture);
    expect(result.valid).toBe(true);
  });

  it('rejects non-doc nodes', () => {
    const result = validateArchivalDoc({ type: 'paragraph', content: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
