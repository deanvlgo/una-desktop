import { cloneDoc, findNodeById, nodeChildren, removeNodeAtPath, removeSuggestionBlocksBySid, walkNodes } from './tree';
import { canParentContain, createSuggestionBlockNode, ensureSeriesOpsNode } from './suggestions';
import type { MoveCrossSeriesPayload, SeriesDoc, SuggestionBlockNode, UUID } from './types';

export type SeriesWorkspace = Record<string, SeriesDoc>;

export type MoveProposalStaleness = {
  stale: boolean;
  reason?: string;
};

export type MoveApplyResult = {
  status: 'applied' | 'noop' | 'stale' | 'failed';
  reason?: string;
  docs: SeriesWorkspace;
  removedProposalCount: number;
};

export function createPairedMoveProposals(args: {
  sourceDoc: SeriesDoc;
  targetDoc: SeriesDoc;
  payload: MoveCrossSeriesPayload;
  author: string;
  sid: UUID;
  createdAt?: number;
  groupId?: UUID;
}): { sourceDoc: SeriesDoc; targetDoc: SeriesDoc; sid: UUID } {
  const block = createSuggestionBlockNode({
    sid: args.sid,
    kind: 'MOVE_SUBTREE_CROSS_SERIES',
    payload: args.payload as Record<string, unknown>,
    author: args.author,
    createdAt: args.createdAt,
    groupId: args.groupId,
  });

  const sourceNext = appendMoveProposal(args.sourceDoc, block);
  const targetNext = appendMoveProposal(args.targetDoc, block);

  return {
    sourceDoc: sourceNext,
    targetDoc: targetNext,
    sid: args.sid,
  };
}

export function evaluateMoveProposalStaleness(workspace: SeriesWorkspace, sid: UUID): MoveProposalStaleness {
  const proposal = findMoveProposal(workspace, sid);
  if (!proposal) {
    return { stale: true, reason: 'Move proposal not found.' };
  }

  const payload = proposal.payload;
  const sourceDoc = workspace[payload.source.docName];
  const targetDoc = workspace[payload.target.docName];

  if (!sourceDoc || !targetDoc) {
    return { stale: false, reason: 'Referenced source/target docs are unreachable.' };
  }

  const sourceRoot = findNodeById(sourceDoc, payload.subtreeRootId, ['subseries', 'file', 'item']);
  if (!sourceRoot) {
    const alreadyInTarget = findNodeById(targetDoc, payload.subtreeRootId);
    if (alreadyInTarget) {
      return { stale: false };
    }
    return { stale: true, reason: 'Subtree root no longer exists in source doc.' };
  }

  const targetParent = findNodeById(targetDoc, payload.targetParentId, ['series', 'subseries', 'file']);
  if (!targetParent) {
    return { stale: true, reason: 'Target parent no longer exists in target doc.' };
  }

  if (!canParentContain(targetParent.node.type, sourceRoot.node.type)) {
    return { stale: true, reason: 'Move would violate schema constraints.' };
  }

  if (payload.placement.kind === 'before' || payload.placement.kind === 'after') {
    const siblingId = payload.placement.siblingId;
    const sibling = nodeChildren(targetParent.node).find((child) => child.attrs?.id === siblingId);
    if (!sibling) {
      return { stale: true, reason: 'Target sibling for placement no longer exists.' };
    }
    if (sibling.type !== sourceRoot.node.type) {
      return { stale: true, reason: 'Placement sibling type no longer matches moving subtree type.' };
    }
  }

  return { stale: false };
}

export function acceptMoveSubtreeCrossSeries(workspace: SeriesWorkspace, sid: UUID): MoveApplyResult {
  const proposal = findMoveProposal(workspace, sid);
  const nextWorkspace = cloneWorkspace(workspace);

  if (!proposal) {
    return {
      status: 'noop',
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  const payload = proposal.payload;
  const sourceDoc = nextWorkspace[payload.source.docName];
  const targetDoc = nextWorkspace[payload.target.docName];

  if (!sourceDoc || !targetDoc) {
    return {
      status: 'failed',
      reason: 'Referenced source/target docs are unreachable.',
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  const stale = evaluateMoveProposalStaleness(nextWorkspace, sid);
  if (stale.stale) {
    return {
      status: 'stale',
      reason: stale.reason,
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  const sourceNodeLoc = findNodeById(sourceDoc, payload.subtreeRootId, ['subseries', 'file', 'item']);
  const targetParentLoc = findNodeById(targetDoc, payload.targetParentId, ['series', 'subseries', 'file']);

  if (!targetParentLoc) {
    return {
      status: 'stale',
      reason: 'Target parent no longer exists.',
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  const alreadyInTarget = findNodeById(targetDoc, payload.subtreeRootId);

  if (!sourceNodeLoc && alreadyInTarget) {
    const removed = removeProposalEverywhere(nextWorkspace, sid);
    return {
      status: 'applied',
      docs: nextWorkspace,
      removedProposalCount: removed,
    };
  }

  if (!sourceNodeLoc) {
    return {
      status: 'stale',
      reason: 'Subtree root missing in source doc.',
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  if (!canParentContain(targetParentLoc.node.type, sourceNodeLoc.node.type)) {
    return {
      status: 'stale',
      reason: 'Move would violate schema constraints.',
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  if (!alreadyInTarget) {
    const parentChildren = nodeChildren(targetParentLoc.node);
    const movingNode = structuredClone(sourceNodeLoc.node);

    let insertIndex = parentChildren.length;
    const placement = payload.placement;

    if (placement.kind === 'before' || placement.kind === 'after') {
      const siblingId = placement.siblingId;
      const siblingIndex = parentChildren.findIndex(
        (child) => child.attrs?.id === siblingId,
      );
      if (siblingIndex < 0) {
        return {
          status: 'stale',
          reason: 'Target sibling no longer exists for before/after placement.',
          docs: nextWorkspace,
          removedProposalCount: 0,
        };
      }

      insertIndex = placement.kind === 'before' ? siblingIndex : siblingIndex + 1;
    }

    parentChildren.splice(insertIndex, 0, movingNode);
  }

  removeNodeAtPath(sourceDoc, sourceNodeLoc.path);
  const removed = removeProposalEverywhere(nextWorkspace, sid);

  return {
    status: 'applied',
    docs: nextWorkspace,
    removedProposalCount: removed,
  };
}

export function rejectMoveSubtreeCrossSeries(workspace: SeriesWorkspace, sid: UUID): MoveApplyResult {
  const nextWorkspace = cloneWorkspace(workspace);
  const removed = removeProposalEverywhere(nextWorkspace, sid);

  if (removed === 0) {
    return {
      status: 'noop',
      docs: nextWorkspace,
      removedProposalCount: 0,
    };
  }

  return {
    status: 'applied',
    docs: nextWorkspace,
    removedProposalCount: removed,
  };
}

function appendMoveProposal(doc: SeriesDoc, block: SuggestionBlockNode): SeriesDoc {
  const next = ensureSeriesOpsNode(doc);
  const seriesRoot = next.content[0];
  const content = nodeChildren(seriesRoot);
  const opsNode = content.find((node) => node.type === 'seriesOps');

  if (!opsNode) {
    return next;
  }

  nodeChildren(opsNode).push(structuredClone(block));
  return next;
}

function cloneWorkspace(workspace: SeriesWorkspace): SeriesWorkspace {
  const next: SeriesWorkspace = {};
  for (const [docName, doc] of Object.entries(workspace)) {
    next[docName] = cloneDoc(doc);
  }
  return next;
}

function removeProposalEverywhere(workspace: SeriesWorkspace, sid: UUID): number {
  let removed = 0;

  for (const doc of Object.values(workspace)) {
    removed += removeSuggestionBlocksBySid(doc, sid);
  }

  return removed;
}

function findMoveProposal(workspace: SeriesWorkspace, sid: UUID): {
  sid: UUID;
  payload: MoveCrossSeriesPayload;
  docNames: string[];
} | null {
  const docNames: string[] = [];
  let payload: MoveCrossSeriesPayload | null = null;

  for (const [docName, doc] of Object.entries(workspace)) {
    walkNodes(doc, (node) => {
      if (node.type !== 'suggestion_block') {
        return;
      }
      if (node.attrs?.sid !== sid || node.attrs?.kind !== 'MOVE_SUBTREE_CROSS_SERIES') {
        return;
      }

      docNames.push(docName);
      if (!payload) {
        payload = node.attrs.payload as MoveCrossSeriesPayload;
      }
    });
  }

  if (!payload) {
    return null;
  }

  return {
    sid,
    payload,
    docNames,
  };
}
