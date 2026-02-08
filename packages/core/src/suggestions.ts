import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

import { createItemNode } from './defaults';
import { cloneDoc, findNodeById, findSuggestionBlockBySid, nodeChildren, removeSuggestionBlocksBySid, walkNodes } from './tree';
import type {
  PMDoc,
  PMNode,
  SeriesDoc,
  SuggestionBlockNode,
  SuggestionDeleteNode,
  SuggestionKind,
  SuggestionInsertMark,
  UUID,
} from './types';

const CREATE_ITEM_NAMESPACE = '2c45f7ac-1dfd-46a8-9fb7-84617f230f5c';
const SET_FIELD_NAMESPACE = '8aabfb08-bcc8-4da1-bd9b-f4f3a596f4f5';

const PARENT_ALLOWED_CHILDREN: Record<string, string[]> = {
  series: ['subseries', 'file'],
  subseries: ['subseries', 'file'],
  file: ['item'],
};

export type SuggestionApplyStatus = 'applied' | 'noop' | 'stale' | 'failed';

export type SuggestionApplyResult = {
  status: SuggestionApplyStatus;
  reason?: string;
  doc: SeriesDoc;
  removedSuggestionCount: number;
};

export type InlineSuggestionResult<T extends PMDoc | PMNode> = {
  doc: T;
  changed: boolean;
};

export type BlockSuggestionView = {
  sid: UUID;
  kind: SuggestionKind;
  author: string;
  createdAt: number;
  groupId?: UUID;
  payload: Record<string, unknown>;
  stale: boolean;
  staleReason?: string;
};

export type SuggestionGroupResult = {
  doc: SeriesDoc;
  applied: UUID[];
  stale: UUID[];
  failed: UUID[];
  noop: UUID[];
};

export function ensureSeriesOpsNode(doc: SeriesDoc): SeriesDoc {
  const next = cloneDoc(doc);
  const seriesRoot = next.content[0];
  const content = nodeChildren(seriesRoot);

  const existingIndex = content.findIndex((node) => node.type === 'seriesOps');
  if (existingIndex >= 0) {
    return next;
  }

  content.splice(0, 0, {
    type: 'seriesOps',
    content: [],
  });

  return next;
}

export function appendSeriesOpSuggestion(doc: SeriesDoc, suggestion: SuggestionBlockNode): SeriesDoc {
  const next = ensureSeriesOpsNode(doc);
  const seriesRoot = next.content[0];
  const content = nodeChildren(seriesRoot);

  const opsNode = content.find((node) => node.type === 'seriesOps');
  if (!opsNode) {
    return next;
  }

  const opsChildren = nodeChildren(opsNode);
  opsChildren.push(structuredClone(suggestion));
  return next;
}

export function createSuggestionBlockNode(args: {
  sid?: UUID;
  kind: SuggestionKind;
  payload: Record<string, unknown>;
  author: string;
  createdAt?: number;
  groupId?: UUID;
}): SuggestionBlockNode {
  return {
    type: 'suggestion_block',
    attrs: {
      sid: args.sid ?? uuidv4(),
      kind: args.kind,
      payload: structuredClone(args.payload) as SuggestionBlockNode['attrs']['payload'],
      author: args.author,
      createdAt: args.createdAt ?? Date.now(),
      groupId: args.groupId,
    },
  };
}

export function listBlockSuggestions(doc: SeriesDoc): BlockSuggestionView[] {
  const views: BlockSuggestionView[] = [];

  walkNodes(doc, (node) => {
    if (node.type !== 'suggestion_block') {
      return;
    }

    const suggestion = node as SuggestionBlockNode;
    const stale = evaluateSuggestionBlockStaleness(doc, suggestion);

    views.push({
      sid: suggestion.attrs.sid,
      kind: suggestion.attrs.kind,
      author: suggestion.attrs.author,
      createdAt: suggestion.attrs.createdAt,
      groupId: suggestion.attrs.groupId,
      payload: (suggestion.attrs.payload ?? {}) as Record<string, unknown>,
      stale: stale.stale,
      staleReason: stale.reason,
    });
  });

  return views;
}

export function evaluateSuggestionBlockStaleness(
  doc: SeriesDoc,
  suggestion: SuggestionBlockNode,
): { stale: boolean; reason?: string } {
  const kind = suggestion.attrs.kind;

  if (kind === 'CREATE_ITEM') {
    const payload = suggestion.attrs.payload as { parentFileId?: UUID; insert?: { kind?: string; siblingId?: UUID } };

    if (!payload.parentFileId) {
      return { stale: true, reason: 'CREATE_ITEM missing parentFileId' };
    }

    const parent = findNodeById(doc, payload.parentFileId, ['file']);
    if (!parent) {
      return { stale: true, reason: 'Target file no longer exists' };
    }

    const insert = payload.insert;
    if (insert && (insert.kind === 'before' || insert.kind === 'after')) {
      const siblingId = insert.siblingId;
      if (!siblingId) {
        return { stale: true, reason: 'Insert payload missing siblingId' };
      }
      const sibling = nodeChildren(parent.node).find((child) => child.attrs?.id === siblingId && child.type === 'item');
      if (!sibling) {
        return { stale: true, reason: 'Insert sibling no longer exists in target file' };
      }
    }

    return { stale: false };
  }

  if (kind === 'SET_FIELD') {
    const payload = suggestion.attrs.payload as { itemId?: UUID };
    if (!payload.itemId) {
      return { stale: true, reason: 'SET_FIELD missing itemId' };
    }

    const item = findNodeById(doc, payload.itemId, ['item']);
    if (!item) {
      return { stale: true, reason: 'Target item no longer exists' };
    }

    return { stale: false };
  }

  if (kind === 'REORDER_SIBLING') {
    const payload = suggestion.attrs.payload as {
      parentId?: UUID;
      nodeId?: UUID;
      targetSiblingId?: UUID;
      placement?: 'before' | 'after';
    };

    if (!payload.parentId || !payload.nodeId || !payload.targetSiblingId || !payload.placement) {
      return { stale: true, reason: 'REORDER_SIBLING payload is incomplete' };
    }

    const parent = findNodeById(doc, payload.parentId, ['series', 'subseries', 'file']);
    if (!parent) {
      return { stale: true, reason: 'Parent no longer exists' };
    }

    const children = nodeChildren(parent.node);
    const source = children.find((child) => child.attrs?.id === payload.nodeId);
    const target = children.find((child) => child.attrs?.id === payload.targetSiblingId);

    if (!source || !target) {
      return { stale: true, reason: 'Sibling node missing from parent' };
    }

    if (source.type !== target.type) {
      return { stale: true, reason: 'Reorder targets are no longer same sibling type' };
    }

    if (!canParentContain(parent.node.type, source.type)) {
      return { stale: true, reason: 'Reorder would violate schema constraints' };
    }

    return { stale: false };
  }

  if (kind === 'MOVE_SUBTREE_CROSS_SERIES') {
    return { stale: false };
  }

  return { stale: true, reason: `Unsupported suggestion kind: ${kind}` };
}

export function acceptSuggestionBlock(doc: SeriesDoc, sid: UUID): SuggestionApplyResult {
  const next = cloneDoc(doc);
  const location = findSuggestionBlockBySid(next, sid);

  if (!location) {
    return {
      status: 'noop',
      doc: next,
      removedSuggestionCount: 0,
    };
  }

  const suggestion = location.node as SuggestionBlockNode;
  const stale = evaluateSuggestionBlockStaleness(next, suggestion);
  if (stale.stale) {
    return {
      status: 'stale',
      reason: stale.reason,
      doc: next,
      removedSuggestionCount: 0,
    };
  }

  let applyResult: { ok: boolean; reason?: string };

  switch (suggestion.attrs.kind) {
    case 'CREATE_ITEM':
      applyResult = applyCreateItem(next, suggestion);
      break;
    case 'SET_FIELD':
      applyResult = applySetField(next, suggestion);
      break;
    case 'REORDER_SIBLING':
      applyResult = applyReorderSibling(next, suggestion);
      break;
    case 'MOVE_SUBTREE_CROSS_SERIES':
      applyResult = {
        ok: false,
        reason: 'Use acceptMoveSubtreeCrossSeries() for MOVE_SUBTREE_CROSS_SERIES proposals.',
      };
      break;
    default:
      applyResult = { ok: false, reason: 'Unsupported suggestion kind.' };
      break;
  }

  if (!applyResult.ok) {
    return {
      status: suggestion.attrs.kind === 'MOVE_SUBTREE_CROSS_SERIES' ? 'failed' : 'stale',
      reason: applyResult.reason,
      doc: next,
      removedSuggestionCount: 0,
    };
  }

  const removed = removeSuggestionBlocksBySid(next, sid);
  return {
    status: 'applied',
    doc: next,
    removedSuggestionCount: removed,
  };
}

export function rejectSuggestionBlock(doc: SeriesDoc, sid: UUID): SuggestionApplyResult {
  const next = cloneDoc(doc);
  const removed = removeSuggestionBlocksBySid(next, sid);

  if (removed === 0) {
    return {
      status: 'noop',
      doc: next,
      removedSuggestionCount: 0,
    };
  }

  return {
    status: 'applied',
    doc: next,
    removedSuggestionCount: removed,
  };
}

export function acceptSuggestionGroup(doc: SeriesDoc, groupId: UUID): SuggestionGroupResult {
  const suggestions = listBlockSuggestions(doc).filter((entry) => entry.groupId === groupId);
  let current = cloneDoc(doc);

  const result: SuggestionGroupResult = {
    doc: current,
    applied: [],
    stale: [],
    failed: [],
    noop: [],
  };

  for (const suggestion of suggestions) {
    const applied = acceptSuggestionBlock(current, suggestion.sid);
    current = applied.doc;

    if (applied.status === 'applied') {
      result.applied.push(suggestion.sid);
    } else if (applied.status === 'stale') {
      result.stale.push(suggestion.sid);
    } else if (applied.status === 'failed') {
      result.failed.push(suggestion.sid);
    } else {
      result.noop.push(suggestion.sid);
    }
  }

  result.doc = current;
  return result;
}

export function rejectSuggestionGroup(doc: SeriesDoc, groupId: UUID): SuggestionGroupResult {
  const suggestions = listBlockSuggestions(doc).filter((entry) => entry.groupId === groupId);
  let current = cloneDoc(doc);

  const result: SuggestionGroupResult = {
    doc: current,
    applied: [],
    stale: [],
    failed: [],
    noop: [],
  };

  for (const suggestion of suggestions) {
    const rejected = rejectSuggestionBlock(current, suggestion.sid);
    current = rejected.doc;

    if (rejected.status === 'applied') {
      result.applied.push(suggestion.sid);
    } else {
      result.noop.push(suggestion.sid);
    }
  }

  result.doc = current;
  return result;
}

export function acceptSuggestionInsert<T extends PMDoc | PMNode>(root: T, sid: UUID): InlineSuggestionResult<T> {
  const next = cloneDoc(root);
  let changed = false;

  walkInline(next, (node) => {
    if (node.type !== 'text' || !Array.isArray(node.marks) || node.marks.length === 0) {
      return;
    }

    const before = node.marks.length;
    node.marks = node.marks.filter(
      (mark) => !(mark.type === 'suggestion_insert' && (mark as SuggestionInsertMark).attrs?.sid === sid),
    );

    if (node.marks.length !== before) {
      changed = true;
    }

    if (node.marks.length === 0) {
      delete node.marks;
    }
  });

  return { doc: next, changed };
}

export function rejectSuggestionInsert<T extends PMDoc | PMNode>(root: T, sid: UUID): InlineSuggestionResult<T> {
  const next = cloneDoc(root);
  const changed = removeMarkedText(next, sid);
  return { doc: next, changed };
}

export function acceptSuggestionDelete<T extends PMDoc | PMNode>(root: T, sid: UUID): InlineSuggestionResult<T> {
  const next = cloneDoc(root);
  const changed = pruneInlineDeleteNodes(next, sid, false);
  return { doc: next, changed };
}

export function rejectSuggestionDelete<T extends PMDoc | PMNode>(root: T, sid: UUID): InlineSuggestionResult<T> {
  const next = cloneDoc(root);
  const changed = pruneInlineDeleteNodes(next, sid, true);
  return { doc: next, changed };
}

export function listInlineSuggestionIds(root: PMDoc | PMNode): {
  insertIds: UUID[];
  deleteIds: UUID[];
} {
  const insert = new Set<UUID>();
  const deletion = new Set<UUID>();

  walkInline(root, (node) => {
    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        if (mark.type === 'suggestion_insert' && mark.attrs?.sid) {
          insert.add(String(mark.attrs.sid));
        }
      }
      return;
    }

    if (node.type === 'suggestion_delete' && node.attrs?.sid) {
      deletion.add(String(node.attrs.sid));
    }
  });

  return {
    insertIds: [...insert],
    deleteIds: [...deletion],
  };
}

function applyCreateItem(doc: SeriesDoc, suggestion: SuggestionBlockNode): { ok: boolean; reason?: string } {
  const payload = suggestion.attrs.payload as {
    parentFileId: UUID;
    itemType: 'photograph' | 'document' | 'object';
    initialFields?: Record<string, unknown>;
    initialBodyText?: string;
    insert?: { kind: 'append' | 'before' | 'after'; siblingId?: UUID };
  };

  const parent = findNodeById(doc, payload.parentFileId, ['file']);
  if (!parent) {
    return { ok: false, reason: 'Target file no longer exists.' };
  }

  const children = nodeChildren(parent.node);
  const deterministicId = uuidv5(`create-item:${suggestion.attrs.sid}`, CREATE_ITEM_NAMESPACE);
  if (children.some((node) => node.type === 'item' && node.attrs?.id === deterministicId)) {
    return { ok: true };
  }

  const nextItem = createItemNode({
    itemType: payload.itemType,
    initialFields: payload.initialFields as Record<string, unknown> | undefined,
    initialBodyText: payload.initialBodyText,
  }) as PMNode;
  stabilizeCreatedItemIds(nextItem, suggestion.attrs.sid, deterministicId);
  nextItem.attrs = {
    ...nextItem.attrs,
    id: deterministicId,
  };

  let insertIndex = children.length;
  const insert = payload.insert;
  if (insert && (insert.kind === 'before' || insert.kind === 'after')) {
    if (!insert.siblingId) {
      return { ok: false, reason: 'Insert sibling is required for before/after placement.' };
    }

    const siblingIndex = children.findIndex((node) => node.attrs?.id === insert.siblingId);
    if (siblingIndex < 0) {
      return { ok: false, reason: 'Insert sibling no longer exists.' };
    }

    insertIndex = insert.kind === 'before' ? siblingIndex : siblingIndex + 1;
  }

  children.splice(insertIndex, 0, nextItem);
  return { ok: true };
}

function applySetField(doc: SeriesDoc, suggestion: SuggestionBlockNode): { ok: boolean; reason?: string } {
  const payload = suggestion.attrs.payload as {
    itemId: UUID;
    key: string;
    valueType: 'text' | 'date' | 'number' | 'select' | 'boolean';
    value: string | number | boolean | null;
  };

  const item = findNodeById(doc, payload.itemId, ['item']);
  if (!item) {
    return { ok: false, reason: 'Target item no longer exists.' };
  }

  const itemFields = nodeChildren(item.node).find((node) => node.type === 'itemFields');
  if (!itemFields) {
    return { ok: false, reason: 'itemFields node is missing.' };
  }

  const fields = nodeChildren(itemFields);

  for (const field of fields) {
    if (field.type === 'field' && field.attrs?.key === payload.key) {
      field.attrs = {
        ...field.attrs,
        valueType: payload.valueType,
        value: payload.value,
      };
      return { ok: true };
    }

    if (field.type === 'fieldGroup') {
      for (const groupedField of nodeChildren(field)) {
        if (groupedField.type === 'field' && groupedField.attrs?.key === payload.key) {
          groupedField.attrs = {
            ...groupedField.attrs,
            valueType: payload.valueType,
            value: payload.value,
          };
          return { ok: true };
        }
      }
    }
  }

  fields.push({
    type: 'field',
    attrs: {
      id: uuidv5(`set-field:${suggestion.attrs.sid}:${payload.key}`, SET_FIELD_NAMESPACE),
      key: payload.key,
      valueType: payload.valueType,
      value: payload.value,
    },
  });

  return { ok: true };
}

function applyReorderSibling(doc: SeriesDoc, suggestion: SuggestionBlockNode): { ok: boolean; reason?: string } {
  const payload = suggestion.attrs.payload as {
    parentId: UUID;
    nodeId: UUID;
    targetSiblingId: UUID;
    placement: 'before' | 'after';
  };

  const parent = findNodeById(doc, payload.parentId, ['series', 'subseries', 'file']);
  if (!parent) {
    return { ok: false, reason: 'Parent no longer exists.' };
  }

  const children = nodeChildren(parent.node);
  const nodeIndex = children.findIndex((child) => child.attrs?.id === payload.nodeId);
  const targetIndex = children.findIndex((child) => child.attrs?.id === payload.targetSiblingId);

  if (nodeIndex < 0 || targetIndex < 0) {
    return { ok: false, reason: 'Sibling nodes are no longer in the referenced parent.' };
  }

  const moving = children[nodeIndex];
  const target = children[targetIndex];

  if (!moving || !target) {
    return { ok: false, reason: 'Sibling lookup failed.' };
  }

  if (moving.type !== target.type) {
    return { ok: false, reason: 'Reorder targets must remain same sibling type.' };
  }

  if (!canParentContain(parent.node.type, moving.type)) {
    return { ok: false, reason: 'Reorder would violate schema constraints.' };
  }

  const alreadyInPlace =
    (payload.placement === 'before' && nodeIndex === targetIndex - 1) ||
    (payload.placement === 'after' && nodeIndex === targetIndex + 1);
  if (alreadyInPlace) {
    return { ok: true };
  }

  const [removed] = children.splice(nodeIndex, 1);
  if (!removed) {
    return { ok: false, reason: 'Failed to remove moving node.' };
  }

  let insertIndex = targetIndex;
  if (nodeIndex < targetIndex) {
    insertIndex -= 1;
  }
  if (payload.placement === 'after') {
    insertIndex += 1;
  }

  children.splice(insertIndex, 0, removed);
  return { ok: true };
}

export function canParentContain(parentType: string, childType: string): boolean {
  const allowed = PARENT_ALLOWED_CHILDREN[parentType];
  if (!allowed) {
    return false;
  }
  return allowed.includes(childType);
}

function walkInline(node: PMDoc | PMNode, visit: (node: PMNode) => void): void {
  if ((node as PMNode).type) {
    visit(node as PMNode);
  }

  const content = (node as PMDoc | PMNode).content;
  if (!content) {
    return;
  }

  for (const child of content) {
    walkInline(child, visit);
  }
}

function removeMarkedText(node: PMDoc | PMNode, sid: UUID): boolean {
  const content = (node as PMDoc | PMNode).content;
  if (!content) {
    return false;
  }

  let changed = false;
  const next: PMNode[] = [];

  for (const child of content) {
    const shouldDrop =
      child.type === 'text' &&
      Array.isArray(child.marks) &&
      child.marks.some((mark) => mark.type === 'suggestion_insert' && mark.attrs?.sid === sid);

    if (shouldDrop) {
      changed = true;
      continue;
    }

    if (removeMarkedText(child, sid)) {
      changed = true;
    }

    next.push(child);
  }

  if (changed) {
    (node as PMDoc | PMNode).content = next;
  }

  return changed;
}

function pruneInlineDeleteNodes(node: PMDoc | PMNode, sid: UUID, restoreText: boolean): boolean {
  const content = (node as PMDoc | PMNode).content;
  if (!content) {
    return false;
  }

  let changed = false;
  const next: PMNode[] = [];

  for (const child of content) {
    if (child.type === 'suggestion_delete' && child.attrs?.sid === sid) {
      changed = true;
      if (restoreText) {
        const source = child as SuggestionDeleteNode;
        next.push({
          type: 'text',
          text: source.attrs.text,
        });
      }
      continue;
    }

    if (pruneInlineDeleteNodes(child, sid, restoreText)) {
      changed = true;
    }

    next.push(child);
  }

  if (changed) {
    (node as PMDoc | PMNode).content = next;
  }

  return changed;
}

function stabilizeCreatedItemIds(node: PMNode, sid: UUID, itemId: UUID): void {
  let fieldCounter = 0;
  let groupCounter = 0;

  walkInline(node, (child) => {
    if (!child.attrs) {
      return;
    }

    if (child.type === 'fieldGroup') {
      child.attrs = {
        ...child.attrs,
        id: uuidv5(`create-item:${sid}:${itemId}:group:${groupCounter}`, CREATE_ITEM_NAMESPACE),
      };
      groupCounter += 1;
      return;
    }

    if (child.type === 'field') {
      child.attrs = {
        ...child.attrs,
        id: uuidv5(`create-item:${sid}:${itemId}:field:${fieldCounter}`, CREATE_ITEM_NAMESPACE),
      };
      fieldCounter += 1;
    }
  });
}
