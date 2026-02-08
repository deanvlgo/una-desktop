import { describe, expect, it } from 'vitest';

import {
  acceptMoveSubtreeCrossSeries,
  createPairedMoveProposals,
  evaluateMoveProposalStaleness,
  rejectMoveSubtreeCrossSeries,
  type SeriesWorkspace,
} from './cross-series';
import { seriesDocName } from './rooms';
import type { MoveCrossSeriesPayload, SeriesDoc } from './types';

function buildSourceDoc(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: { id: 'series-a', title: 'Series A' },
        content: [
          { type: 'seriesOps', content: [] },
          {
            type: 'subseries',
            attrs: { id: 'subseries-a1', title: 'Subseries A1' },
            content: [
              {
                type: 'file',
                attrs: { id: 'file-a3', title: 'To Move' },
                content: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildTargetDoc(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: { id: 'series-b', title: 'Series B' },
        content: [
          { type: 'seriesOps', content: [] },
          {
            type: 'subseries',
            attrs: { id: 'subseries-b1', title: 'Subseries B1' },
            content: [],
          },
        ],
      },
    ],
  };
}

describe('cross-series move proposals', () => {
  it('creates paired proposals and accepts move safely', () => {
    const payload: MoveCrossSeriesPayload = {
      source: { seriesId: 'series-a', docName: seriesDocName('col-001', 'series-a') },
      target: { seriesId: 'series-b', docName: seriesDocName('col-001', 'series-b') },
      subtreeRootId: 'file-a3',
      targetParentId: 'subseries-b1',
      placement: { kind: 'append' },
    };

    const pair = createPairedMoveProposals({
      sourceDoc: buildSourceDoc(),
      targetDoc: buildTargetDoc(),
      payload,
      sid: 'move-1',
      author: 'LLM',
    });

    const workspace: SeriesWorkspace = {
      [payload.source.docName]: pair.sourceDoc,
      [payload.target.docName]: pair.targetDoc,
    };

    const stale = evaluateMoveProposalStaleness(workspace, 'move-1');
    expect(stale.stale).toBe(false);

    const applied = acceptMoveSubtreeCrossSeries(workspace, 'move-1');
    expect(applied.status).toBe('applied');
    expect(applied.removedProposalCount).toBe(2);

    const movedInTarget = JSON.stringify(applied.docs[payload.target.docName]).includes('file-a3');
    const stillInSource = JSON.stringify(applied.docs[payload.source.docName]).includes('file-a3');

    expect(movedInTarget).toBe(true);
    expect(stillInSource).toBe(false);

    const noop = acceptMoveSubtreeCrossSeries(applied.docs, 'move-1');
    expect(noop.status).toBe('noop');
  });

  it('reject removes proposals from both docs', () => {
    const payload: MoveCrossSeriesPayload = {
      source: { seriesId: 'series-a', docName: seriesDocName('col-001', 'series-a') },
      target: { seriesId: 'series-b', docName: seriesDocName('col-001', 'series-b') },
      subtreeRootId: 'file-a3',
      targetParentId: 'subseries-b1',
      placement: { kind: 'append' },
    };

    const pair = createPairedMoveProposals({
      sourceDoc: buildSourceDoc(),
      targetDoc: buildTargetDoc(),
      payload,
      sid: 'move-2',
      author: 'LLM',
    });

    const workspace: SeriesWorkspace = {
      [payload.source.docName]: pair.sourceDoc,
      [payload.target.docName]: pair.targetDoc,
    };

    const rejected = rejectMoveSubtreeCrossSeries(workspace, 'move-2');
    expect(rejected.status).toBe('applied');
    expect(rejected.removedProposalCount).toBe(2);
  });

  it('marks stale when subtree was removed before accept', () => {
    const payload: MoveCrossSeriesPayload = {
      source: { seriesId: 'series-a', docName: seriesDocName('col-001', 'series-a') },
      target: { seriesId: 'series-b', docName: seriesDocName('col-001', 'series-b') },
      subtreeRootId: 'missing-file',
      targetParentId: 'subseries-b1',
      placement: { kind: 'append' },
    };

    const pair = createPairedMoveProposals({
      sourceDoc: buildSourceDoc(),
      targetDoc: buildTargetDoc(),
      payload,
      sid: 'move-3',
      author: 'LLM',
    });

    const workspace: SeriesWorkspace = {
      [payload.source.docName]: pair.sourceDoc,
      [payload.target.docName]: pair.targetDoc,
    };

    const applied = acceptMoveSubtreeCrossSeries(workspace, 'move-3');
    expect(applied.status).toBe('stale');
  });
});
