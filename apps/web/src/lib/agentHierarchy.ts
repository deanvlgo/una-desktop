import type { PMNode, SeriesDoc, SeriesNode } from '../../../../src/contracts/types';
import { getSeriesBodyText } from './series';

type HierarchyLevel = 'series' | 'subseries' | 'file' | 'item';

export type AssistantHierarchyNode = {
  level: string;
  id?: string;
  provisional_title?: string;
  scope_note?: string;
  item_type?: string;
  children?: AssistantHierarchyNode[];
};

const HIERARCHY_LEVELS = new Set<HierarchyLevel>(['series', 'subseries', 'file', 'item']);

export function buildAssistantHierarchyFromSeriesDoc(doc: SeriesDoc): AssistantHierarchyNode[] {
  const root = findSeriesRoot(doc);
  if (!root) {
    return [];
  }

  const rootScope = normalizeText(String(root.attrs?.scopeContent ?? '')) || normalizeText(getSeriesBodyText(doc));
  return [toAssistantNode(root, rootScope)];
}

export function buildAssistantOriginalTranscript(doc: SeriesDoc): string {
  const bodyText = normalizeText(getSeriesBodyText(doc));
  const hierarchy = buildAssistantHierarchyFromSeriesDoc(doc);
  const hierarchyLines = hierarchyToOutline(hierarchy);

  const sections: string[] = [];
  if (bodyText) {
    sections.push(bodyText);
  }
  if (hierarchyLines.length > 0) {
    sections.push(`Current hierarchy:\n${hierarchyLines.join('\n')}`);
  }
  return sections.join('\n\n').trim();
}

export function applyAssistantHierarchyToSeriesDoc(doc: SeriesDoc, proposedHierarchy: unknown): SeriesDoc {
  const existingRoot = findSeriesRoot(doc);
  if (!existingRoot) {
    return doc;
  }

  const normalized = normalizeHierarchyPayload(proposedHierarchy);
  if (normalized.length === 0) {
    return doc;
  }

  const incomingRoot =
    findFirstSeriesNode(normalized) ??
    ({
      level: 'series',
      provisional_title: normalizeText(String(existingRoot.attrs?.title ?? '')) || 'Untitled Series',
      children: normalized,
    } satisfies AssistantHierarchyNode);

  const nextDoc = structuredClone(doc);
  const seriesIndex = nextDoc.content.findIndex((node) => node.type === 'series');
  if (seriesIndex < 0) {
    return nextDoc;
  }

  nextDoc.content[seriesIndex] = buildSeriesNodeFromAssistant(incomingRoot, existingRoot);
  return nextDoc;
}

function findSeriesRoot(doc: SeriesDoc): PMNode | null {
  const seriesNode = doc.content.find((node) => node.type === 'series');
  return seriesNode ?? null;
}

function toAssistantNode(node: PMNode, rootScopeText = ''): AssistantHierarchyNode {
  const level = normalizeHierarchyLevel(node.type) ?? 'series';
  const title = normalizeText(level === 'item' ? readItemTitle(node) : String(node.attrs?.title ?? ''));
  const scopeNote =
    normalizeText(level === 'item' ? readItemScope(node) : String(node.attrs?.scopeContent ?? '')) ||
    (level === 'series' ? normalizeText(rootScopeText) : '');

  const children = hierarchyChildren(node).map((child) => toAssistantNode(child));
  return {
    level,
    id: normalizeText(String(node.attrs?.id ?? '')) || undefined,
    provisional_title: title || undefined,
    scope_note: scopeNote || undefined,
    item_type: level === 'item' ? normalizeText(String(node.attrs?.itemType ?? '')) || undefined : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

function hierarchyChildren(node: PMNode): PMNode[] {
  return (node.content ?? []).filter((child) => normalizeHierarchyLevel(child.type) != null);
}

function normalizeHierarchyPayload(input: unknown): AssistantHierarchyNode[] {
  if (Array.isArray(input)) {
    return input.map(normalizeHierarchyNode).filter((node): node is AssistantHierarchyNode => node != null);
  }

  if (input && typeof input === 'object') {
    const asObject = input as { proposed_hierarchy?: unknown };
    if (Array.isArray(asObject.proposed_hierarchy)) {
      return asObject.proposed_hierarchy
        .map(normalizeHierarchyNode)
        .filter((node): node is AssistantHierarchyNode => node != null);
    }
  }

  return [];
}

function normalizeHierarchyNode(raw: unknown): AssistantHierarchyNode | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const levelRaw = normalizeText(String(record.level ?? ''));
  if (!levelRaw) {
    return null;
  }

  const childrenRaw = Array.isArray(record.children) ? record.children : [];
  return {
    level: levelRaw.toLowerCase(),
    id: normalizeText(String(record.id ?? '')) || undefined,
    provisional_title: normalizeText(String(record.provisional_title ?? '')) || undefined,
    scope_note: normalizeText(String(record.scope_note ?? '')) || undefined,
    item_type: normalizeText(String(record.item_type ?? '')) || undefined,
    children: childrenRaw.map(normalizeHierarchyNode).filter((node): node is AssistantHierarchyNode => node != null),
  };
}

function findFirstSeriesNode(nodes: AssistantHierarchyNode[]): AssistantHierarchyNode | null {
  for (const node of nodes) {
    if (normalizeHierarchyLevel(node.level) === 'series') {
      return node;
    }
    const nested = findFirstSeriesNode(node.children ?? []);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function buildSeriesNodeFromAssistant(source: AssistantHierarchyNode, existingSeries: PMNode): SeriesNode {
  const existingSeriesId = normalizeText(String(existingSeries.attrs?.id ?? '')) || createId('series');
  const existingSeriesTitle = normalizeText(String(existingSeries.attrs?.title ?? '')) || 'Untitled Series';
  const nextTitle = normalizeText(source.provisional_title ?? '') || existingSeriesTitle;
  const nextScope = normalizeText(source.scope_note ?? '');

  const existingOps = (existingSeries.content ?? []).find((node) => node.type === 'seriesOps');
  const existingBody = (existingSeries.content ?? []).find((node) => node.type === 'seriesBody');
  const existingHierarchy = hierarchyChildren(existingSeries);
  const incomingChildren = buildChildNodes(source.children ?? [], 'series', existingHierarchy);

  const attrs: SeriesNode['attrs'] = {
    ...(existingSeries.attrs ?? {}),
    id: existingSeriesId,
    title: nextTitle,
  };
  if (nextScope) {
    attrs.scopeContent = nextScope;
  }

  return {
    type: 'series',
    attrs,
    content: [
      structuredClone(existingOps ?? { type: 'seriesOps', content: [] }),
      structuredClone(existingBody ?? { type: 'seriesBody', content: [] }),
      ...incomingChildren,
    ],
  };
}

function buildChildNodes(
  incoming: AssistantHierarchyNode[],
  parentLevel: HierarchyLevel,
  existingChildren: PMNode[],
): PMNode[] {
  const output: PMNode[] = [];
  let existingIndex = 0;

  for (const node of incoming) {
    const level = normalizeHierarchyLevel(node.level);
    if (!level) {
      continue;
    }

    if (!canContain(parentLevel, level)) {
      if (Array.isArray(node.children) && node.children.length > 0) {
        output.push(...buildChildNodes(node.children, parentLevel, existingChildren.slice(existingIndex)));
      }
      continue;
    }

    const candidate = existingChildren[existingIndex];
    const existingMatch = candidate?.type === level ? candidate : null;
    const next = buildNodeFromAssistant(node, level, existingMatch);
    output.push(next);
    existingIndex += 1;
  }

  return output;
}

function buildNodeFromAssistant(source: AssistantHierarchyNode, level: HierarchyLevel, existing: PMNode | null): PMNode {
  const explicitId = normalizeText(source.id ?? '');
  const existingId = normalizeText(String(existing?.attrs?.id ?? ''));
  const id = explicitId || existingId || createId(level);
  const title = normalizeText(source.provisional_title ?? '') || defaultTitle(level);
  const scope = normalizeText(source.scope_note ?? '');

  if (level === 'item') {
    const nextItem = existing?.type === 'item' ? structuredClone(existing) : createEmptyItemNode(id);
    nextItem.attrs = {
      ...(nextItem.attrs ?? {}),
      id,
      itemType: normalizeText(source.item_type ?? '') || String(nextItem.attrs?.itemType ?? 'document'),
    };
    upsertItemTitle(nextItem, title);
    if (scope) {
      upsertItemBodyText(nextItem, scope);
    }
    return nextItem;
  }

  const nextAttrs: Record<string, unknown> = {
    ...(existing?.attrs ?? {}),
    id,
    title,
  };
  if (scope) {
    nextAttrs.scopeContent = scope;
  }

  const existingNested = existing ? hierarchyChildren(existing) : [];
  const nested = buildChildNodes(source.children ?? [], level, existingNested);

  return {
    type: level,
    attrs: nextAttrs,
    content: nested,
  };
}

function upsertItemTitle(itemNode: PMNode, title: string) {
  const content = itemNode.content ?? [];
  let itemFields = content.find((node) => node.type === 'itemFields');
  if (!itemFields) {
    itemFields = { type: 'itemFields', content: [] };
    content.unshift(itemFields);
  }

  const fields = itemFields.content ?? [];
  const existingTitleField = fields.find((field) => field.type === 'field' && String(field.attrs?.key) === 'title');
  if (existingTitleField) {
    existingTitleField.attrs = { ...(existingTitleField.attrs ?? {}), valueType: 'text', value: title };
  } else {
    fields.unshift({
      type: 'field',
      attrs: {
        id: createId('field'),
        key: 'title',
        valueType: 'text',
        value: title,
      },
    });
  }

  itemFields.content = fields;
  itemNode.content = content;
}

function upsertItemBodyText(itemNode: PMNode, text: string) {
  const content = itemNode.content ?? [];
  let itemBody = content.find((node) => node.type === 'itemBody');
  if (!itemBody) {
    itemBody = { type: 'itemBody', content: [] };
    content.push(itemBody);
  }

  itemBody.content = [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ];
  itemNode.content = content;
}

function createEmptyItemNode(id: string): PMNode {
  return {
    type: 'item',
    attrs: { id, itemType: 'document' },
    content: [
      {
        type: 'itemFields',
        content: [],
      },
      {
        type: 'itemBody',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '' }],
          },
        ],
      },
    ],
  };
}

function canContain(parent: HierarchyLevel, child: HierarchyLevel): boolean {
  if (parent === 'series' || parent === 'subseries') {
    return child === 'subseries' || child === 'file';
  }
  if (parent === 'file') {
    return child === 'item';
  }
  return false;
}

function normalizeHierarchyLevel(level: string): HierarchyLevel | null {
  const normalized = normalizeText(level).toLowerCase();
  if (!normalized) {
    return null;
  }
  return HIERARCHY_LEVELS.has(normalized as HierarchyLevel) ? (normalized as HierarchyLevel) : null;
}

function defaultTitle(level: HierarchyLevel): string {
  if (level === 'subseries') {
    return 'Untitled Subseries';
  }
  if (level === 'file') {
    return 'Untitled File';
  }
  if (level === 'item') {
    return 'Untitled Item';
  }
  return 'Untitled Series';
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function readItemTitle(itemNode: PMNode): string {
  const fields = (itemNode.content ?? []).find((node) => node.type === 'itemFields');
  const entries = fields?.content ?? [];
  const preferred = ['title', 'name', 'caption', 'identifier', 'transcription'];

  for (const key of preferred) {
    for (const entry of entries) {
      if (entry.type !== 'field') {
        continue;
      }
      if (String(entry.attrs?.key) !== key) {
        continue;
      }
      const value = normalizeText(String(entry.attrs?.value ?? ''));
      if (value) {
        return value;
      }
    }
  }

  return normalizeText(String(itemNode.attrs?.itemType ?? '')) || 'Item';
}

function readItemScope(itemNode: PMNode): string {
  const body = (itemNode.content ?? []).find((node) => node.type === 'itemBody');
  if (!body?.content) {
    return '';
  }
  const paragraphs = body.content
    .filter((node) => node.type === 'paragraph')
    .map((node) => nodeText(node))
    .filter((text) => text.length > 0);
  return paragraphs.join('\n\n');
}

function nodeText(node: PMNode): string {
  if (node.type === 'text') {
    return normalizeText(String(node.text ?? ''));
  }
  return (node.content ?? []).map((child) => nodeText(child)).join('');
}

function hierarchyToOutline(nodes: AssistantHierarchyNode[]): string[] {
  const lines: string[] = [];
  const walk = (node: AssistantHierarchyNode, depth: number) => {
    const level = normalizeHierarchyLevel(node.level) ?? 'series';
    const title = normalizeText(node.provisional_title ?? '') || defaultTitle(level);
    const indent = '  '.repeat(depth);
    lines.push(`${indent}- ${level}: ${title}`);
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };

  for (const node of nodes) {
    walk(node, 0);
  }
  return lines;
}

function normalizeText(value: string): string {
  return value.trim();
}
