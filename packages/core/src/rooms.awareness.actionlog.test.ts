import { describe, expect, it } from 'vitest';

import { InMemoryAgentActionLog } from './action-log';
import { AwarenessStore } from './awareness';
import { manifestDocName, parseDocName, seriesDocName } from './rooms';

describe('rooms, awareness, action log', () => {
  it('builds and parses room names', () => {
    const manifest = manifestDocName('col-001');
    const series = seriesDocName('col-001', 'series-a');

    expect(manifest).toBe('collection:col-001');
    expect(series).toBe('series:col-001:series-a');

    expect(parseDocName(manifest)).toEqual({ kind: 'manifest', collectionId: 'col-001' });
    expect(parseDocName(series)).toEqual({ kind: 'series', collectionId: 'col-001', seriesId: 'series-a' });
  });

  it('tracks per-doc awareness and focus chips', () => {
    const store = new AwarenessStore();

    store.set('series:col-001:series-a', {
      user: { id: 'u1', name: 'Alex', color: '#f00' },
      focusId: 'item-1',
      updatedAt: 1,
    });

    store.set('series:col-001:series-a', {
      user: { id: 'u2', name: 'Bea', color: '#0f0' },
      focusId: 'item-1',
      updatedAt: 2,
    });

    store.set('series:col-001:series-b', {
      user: { id: 'u3', name: 'Cam', color: '#00f' },
      focusId: null,
      updatedAt: 3,
    });

    expect(store.list('series:col-001:series-a')).toHaveLength(2);
    expect(store.listCollectionPresence('series:col-001')).toEqual({
      'series:col-001:series-a': 2,
      'series:col-001:series-b': 1,
    });

    const chips = store.focusChips('series:col-001:series-a');
    expect(chips['item-1']).toHaveLength(2);
  });

  it('stores and filters agent action log records', () => {
    const log = new InMemoryAgentActionLog();

    log.append({
      opId: 'op-1',
      userId: 'u1',
      createdAt: 1,
      docNames: ['series:col-001:series-a'],
      suggestionIds: ['s1'],
      result: 'ok',
    });

    log.append({
      opId: 'op-2',
      userId: 'u2',
      createdAt: 2,
      docNames: ['series:col-001:series-b'],
      suggestionIds: ['s2'],
      result: 'failed',
      errorMessage: 'stale',
    });

    expect(log.list().length).toBe(2);
    expect(log.list({ result: 'failed' })[0].opId).toBe('op-2');
    expect(log.list({ docName: 'series:col-001:series-a' })[0].opId).toBe('op-1');
  });
});
