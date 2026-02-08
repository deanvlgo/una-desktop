import type { ItemType, PMNode, SeriesDoc, ValueType } from '../../../../src/contracts/types';

export type UUID = string;

export type FocusState = {
  mode: 'document' | 'focus' | 'json';
  focusedId: UUID | null;
  expandedIds: Set<UUID>;
  policy: 'focusPlusAncestors';
};

export type HierarchyLevel = 'series' | 'subseries' | 'file' | 'item';

export type HierarchyNode = {
  id: UUID;
  level: HierarchyLevel;
  title: string;
  itemType?: ItemType;
  children: HierarchyNode[];
};

export type ItemFieldModel = {
  fieldId: UUID;
  key: string;
  valueType: ValueType;
  value: string | number | boolean | null;
  groupKey?: string;
};

export type FocusedNodeModel = {
  id: UUID;
  level: HierarchyLevel;
  title: string;
  dates?: string;
  refCode?: string;
  itemType?: ItemType;
  fields: ItemFieldModel[];
  metadata: Record<string, string>;
};

export function cloneSeriesDoc(doc: SeriesDoc): SeriesDoc {
  return structuredClone(doc);
}

export function createInitialFocusState(seriesRootId: UUID): FocusState {
  return {
    mode: 'document',
    focusedId: seriesRootId,
    expandedIds: new Set([seriesRootId]),
    policy: 'focusPlusAncestors',
  };
}

export function buildHierarchyTree(doc: SeriesDoc): HierarchyNode {
  const seriesRoot = doc.content.find((node) => node.type === 'series');
  if (!seriesRoot) {
    throw new Error('Series document is missing a series root node.');
  }

  return {
    id: String(seriesRoot.attrs?.id ?? 'series-root'),
    level: 'series',
    title: String(seriesRoot.attrs?.title ?? 'Untitled Series'),
    children: nodeChildrenToHierarchy(seriesRoot.content ?? [], String(seriesRoot.attrs?.id ?? 'series-root')),
  };
}

export function getSeriesBodyText(doc: SeriesDoc): string {
  const bodyNodes = getSeriesBodyNodes(doc);
  if (bodyNodes.length === 0) {
    return '';
  }

  return bodyNodes
    .map((child) => extractText(child))
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

export function setSeriesBodyText(doc: SeriesDoc, nextText: string): SeriesDoc {
  return setSeriesBodyNodes(doc, normalizeParagraphs(nextText));
}

export function getSeriesBodyNodes(doc: SeriesDoc): PMNode[] {
  const seriesRoot = doc.content.find((node) => node.type === 'series');
  if (!seriesRoot) {
    return [];
  }

  const seriesBody = (seriesRoot.content ?? []).find((node) => node.type === 'seriesBody');
  return structuredClone((seriesBody?.content ?? []) as PMNode[]);
}

export function setSeriesBodyNodes(doc: SeriesDoc, nextNodes: PMNode[]): SeriesDoc {
  const next = cloneSeriesDoc(doc);
  const seriesRoot = next.content.find((node) => node.type === 'series');
  if (!seriesRoot) {
    return next;
  }

  const content = seriesRoot.content ?? [];
  const bodyIndex = content.findIndex((node) => node.type === 'seriesBody');
  const bodyNode: PMNode = {
    type: 'seriesBody',
    content: structuredClone(nextNodes),
  };

  if (bodyIndex >= 0) {
    content[bodyIndex] = bodyNode;
  } else {
    content.splice(content.length > 0 ? 1 : 0, 0, bodyNode);
  }

  seriesRoot.content = content;
  return next;
}

export function updateNodeTitle(doc: SeriesDoc, nodeId: UUID, title: string): SeriesDoc {
  return updateNodeMetadata(doc, nodeId, { title });
}

export function updateNodeMetadata(
  doc: SeriesDoc,
  nodeId: UUID,
  patch: Record<string, string | undefined>,
): SeriesDoc {
  const next = cloneSeriesDoc(doc);
  walkNodes(next, (node) => {
    if (!node.attrs || String(node.attrs.id) !== nodeId) {
      return;
    }

    if (node.type === 'series' || node.type === 'subseries' || node.type === 'file') {
      const nextAttrs = { ...node.attrs };

      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          continue;
        }
        nextAttrs[key] = value;
      }

      node.attrs = nextAttrs;
    }
  });

  return next;
}

export function readFocusedNode(doc: SeriesDoc, nodeId: UUID | null): FocusedNodeModel | null {
  if (!nodeId) {
    return null;
  }

  const found = findNodeById(doc, nodeId);

  if (!found) {
    return null;
  }

  const type = found.type;
  if (type !== 'series' && type !== 'subseries' && type !== 'file' && type !== 'item') {
    return null;
  }

  const model: FocusedNodeModel = {
    id: nodeId,
    level: type,
    title: labelForNode(found),
    fields: [],
    metadata: {},
  };

  if (type === 'item') {
    model.itemType = found.attrs?.itemType as ItemType | undefined;
    model.fields = readItemFields(found);
  } else {
    model.dates = String(found.attrs?.dates ?? '');
    model.refCode = String(found.attrs?.refCode ?? '');
    model.metadata = readNodeMetadata(found);
  }

  return model;
}

export function updateItemFieldValue(
  doc: SeriesDoc,
  itemId: UUID,
  fieldId: UUID,
  value: string | number | boolean | null,
): SeriesDoc {
  const next = cloneSeriesDoc(doc);

  walkNodes(next, (node) => {
    if (node.type !== 'item' || !node.attrs || String(node.attrs.id) !== itemId) {
      return;
    }

    const itemFields = (node.content ?? []).find((child) => child.type === 'itemFields');
    if (!itemFields?.content) {
      return;
    }

    for (const entry of itemFields.content) {
      if (entry.type === 'field' && String(entry.attrs?.id) === fieldId) {
        entry.attrs = { ...entry.attrs, value };
        return;
      }

      if (entry.type === 'fieldGroup') {
        for (const groupedField of entry.content ?? []) {
          if (groupedField.type === 'field' && String(groupedField.attrs?.id) === fieldId) {
            groupedField.attrs = { ...groupedField.attrs, value };
            return;
          }
        }
      }
    }
  });

  return next;
}

export function moveSiblingHierarchyNode(
  doc: SeriesDoc,
  draggedId: UUID,
  targetId: UUID,
  placement: 'before' | 'after',
): SeriesDoc {
  if (draggedId === targetId) {
    return doc;
  }

  const next = cloneSeriesDoc(doc);
  const dragged = findNodeLocationById(next, draggedId);
  const target = findNodeLocationById(next, targetId);

  if (!dragged || !target) {
    return next;
  }

  if (!isHierarchyBlockNode(dragged.node.type) || !isHierarchyBlockNode(target.node.type)) {
    return next;
  }

  if (dragged.node.type === 'series' || target.node.type === 'series') {
    return next;
  }

  if (dragged.node.type !== target.node.type) {
    return next;
  }

  if (isPathPrefix(dragged.path, target.path)) {
    return next;
  }

  const sourceSiblings = dragged.parent.content ?? [];
  const fromIndex = dragged.index;

  if (fromIndex < 0 || fromIndex >= sourceSiblings.length) {
    return next;
  }

  const destinationParent = target.parent;
  if (!canContainHierarchyNode(destinationParent.type, dragged.node.type)) {
    return next;
  }

  const sameParent = dragged.parent === destinationParent;

  let toIndex = target.index + (placement === 'after' ? 1 : 0);
  if (sameParent && fromIndex < toIndex) {
    toIndex -= 1;
  }

  if (sameParent && toIndex === fromIndex) {
    return next;
  }

  const [moving] = sourceSiblings.splice(fromIndex, 1);
  if (!moving) {
    return next;
  }

  dragged.parent.content = sourceSiblings;

  const destinationSiblings = destinationParent.content ?? [];
  const safeIndex = Math.max(0, Math.min(toIndex, destinationSiblings.length));
  destinationSiblings.splice(safeIndex, 0, moving);
  destinationParent.content = destinationSiblings;
  return next;
}

export function indentHierarchyNode(doc: SeriesDoc, nodeId: UUID): SeriesDoc {
  const next = cloneSeriesDoc(doc);
  const location = findNodeLocationById(next, nodeId);
  if (!location) {
    return next;
  }

  if (location.node.type === 'series') {
    return next;
  }

  const siblings = location.parent.content ?? [];
  if (location.index <= 0 || location.index >= siblings.length) {
    return next;
  }

  const previousSibling = siblings[location.index - 1];
  if (!previousSibling || !canContainHierarchyNode(previousSibling.type, location.node.type)) {
    return next;
  }

  const [moving] = siblings.splice(location.index, 1);
  if (!moving) {
    return next;
  }

  const previousChildren = previousSibling.content ?? [];
  previousChildren.push(moving);
  previousSibling.content = previousChildren;
  location.parent.content = siblings;
  return next;
}

export function outdentHierarchyNode(doc: SeriesDoc, nodeId: UUID): SeriesDoc {
  const next = cloneSeriesDoc(doc);
  const location = findNodeLocationById(next, nodeId);
  if (!location) {
    return next;
  }

  if (location.node.type === 'series') {
    return next;
  }

  if (location.parentPath.length === 0) {
    return next;
  }

  const parentContainer = getNodeAtPath(next, location.parentPath);
  const grandParentPath = location.parentPath.slice(0, -1);
  const grandParentContainer = getNodeAtPath(next, grandParentPath);
  const parentIndex = location.parentPath[location.parentPath.length - 1];

  if (
    !parentContainer ||
    !isTypedNode(parentContainer) ||
    !grandParentContainer ||
    !isTypedNode(grandParentContainer) ||
    parentIndex == null
  ) {
    return next;
  }

  if (!canContainHierarchyNode(grandParentContainer.type, location.node.type)) {
    return next;
  }

  const parentChildren = parentContainer.content ?? [];
  if (location.index < 0 || location.index >= parentChildren.length) {
    return next;
  }

  const [moving] = parentChildren.splice(location.index, 1);
  if (!moving) {
    return next;
  }

  parentContainer.content = parentChildren;

  const grandChildren = grandParentContainer.content ?? [];
  const insertIndex = Math.max(0, Math.min(parentIndex + 1, grandChildren.length));
  grandChildren.splice(insertIndex, 0, moving);
  grandParentContainer.content = grandChildren;
  return next;
}

export function collectHierarchySubtreeIds(doc: SeriesDoc, rootId: UUID): UUID[] {
  const root = findNodeById(doc, rootId);
  if (!root || !isHierarchyBlockNode(root.type)) {
    return [];
  }

  const ids: UUID[] = [];
  const walk = (node: PMNode) => {
    if (!isHierarchyBlockNode(node.type)) {
      return;
    }

    const nodeId = node.attrs?.id;
    if (nodeId != null) {
      ids.push(String(nodeId));
    }

    for (const child of node.content ?? []) {
      walk(child);
    }
  };

  walk(root);
  return ids;
}

export function syncSeriesBodyWithHierarchy(doc: SeriesDoc): SeriesDoc {
  const headings = flattenHierarchyHeadings(buildHierarchyTree(doc));
  if (headings.length === 0) {
    return doc;
  }

  const sections = readSeriesBodySections(doc, headings[0]?.id);
  return writeSeriesBodySections(doc, sections);
}

export function transferHierarchySectionsBetweenDocs(args: {
  sourceDoc: SeriesDoc;
  targetDoc: SeriesDoc;
  hierarchyIds: UUID[];
}): { sourceDoc: SeriesDoc; targetDoc: SeriesDoc } {
  const sourceFirstId = flattenHierarchyHeadings(buildHierarchyTree(args.sourceDoc))[0]?.id;
  const targetFirstId = flattenHierarchyHeadings(buildHierarchyTree(args.targetDoc))[0]?.id;
  const sourceSections = readSeriesBodySections(args.sourceDoc, sourceFirstId);
  const targetSections = readSeriesBodySections(args.targetDoc, targetFirstId);

  for (const id of args.hierarchyIds) {
    const section = sourceSections.get(id);
    if (!section) {
      continue;
    }
    targetSections.set(id, structuredClone(section));
    sourceSections.delete(id);
  }

  return {
    sourceDoc: writeSeriesBodySections(args.sourceDoc, sourceSections),
    targetDoc: writeSeriesBodySections(args.targetDoc, targetSections),
  };
}

export function addHierarchyChildNode(
  doc: SeriesDoc,
  parentId: UUID,
  level: HierarchyLevel,
  options?: { id?: UUID; title?: string; itemType?: ItemType },
): SeriesDoc {
  const next = cloneSeriesDoc(doc);
  const location = findNodeLocationById(next, parentId);
  if (!location) {
    return next;
  }

  if (!canContainHierarchyNode(location.node.type, level)) {
    return next;
  }

  const children = location.node.content ?? [];
  children.push(createHierarchyNode(level, options));
  location.node.content = children;
  return next;
}

export function deleteHierarchyNode(doc: SeriesDoc, nodeId: UUID): SeriesDoc {
  const next = cloneSeriesDoc(doc);
  const location = findNodeLocationById(next, nodeId);
  if (!location) {
    return next;
  }

  if (location.node.type === 'series') {
    return next;
  }

  const siblings = location.parent.content ?? [];
  if (location.index < 0 || location.index >= siblings.length) {
    return next;
  }

  siblings.splice(location.index, 1);
  location.parent.content = siblings;
  return next;
}

export function nodeExists(root: HierarchyNode, id: UUID | null): boolean {
  if (!id) {
    return false;
  }
  return !!findHierarchyNode(root, id);
}

export function findHierarchyNode(root: HierarchyNode, id: UUID): HierarchyNode | null {
  if (root.id === id) {
    return root;
  }

  for (const child of root.children) {
    const found = findHierarchyNode(child, id);
    if (found) {
      return found;
    }
  }

  return null;
}

export function collectAncestorIds(root: HierarchyNode, targetId: UUID | null): Set<UUID> {
  if (!targetId) {
    return new Set<UUID>();
  }

  const path: UUID[] = [];
  collectPath(root, targetId, path);
  return new Set(path);
}

export function isExpandedByPolicy(
  nodeId: UUID,
  focusState: FocusState,
  focusedAncestors: Set<UUID>,
): boolean {
  void focusState;
  void focusedAncestors;

  return focusState.expandedIds.has(nodeId);
}

export function compactSummary(node: HierarchyNode): string {
  if (node.level === 'item') {
    return String(node.itemType ?? 'item').toUpperCase();
  }

  const normalized = node.title.trim();
  return normalized.length > 0 ? normalized : node.level.toUpperCase();
}

function normalizeParagraphs(text: string): PMNode[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return [];
  }

  return paragraphs.map((paragraph) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: paragraph }],
  }));
}

function extractText(node: PMNode): string {
  if (node.type === 'text') {
    return String(node.text ?? '');
  }

  return (node.content ?? []).map((child) => extractText(child)).join('');
}

function nodeChildrenToHierarchy(content: PMNode[], parentPath: string): HierarchyNode[] {
  const hierarchy: HierarchyNode[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const node = content[index];
    if (node.type !== 'subseries' && node.type !== 'file' && node.type !== 'item') {
      continue;
    }

    const nodeId = String(node.attrs?.id ?? `${parentPath}/${node.type}-${index}`);
    const child: HierarchyNode = {
      id: nodeId,
      level: node.type,
      title: labelForNode(node),
      children: [],
    };

    if (node.type === 'item') {
      child.itemType = node.attrs?.itemType as ItemType | undefined;
    }

    child.children = nodeChildrenToHierarchy(node.content ?? [], nodeId);
    hierarchy.push(child);
  }

  return hierarchy;
}

function labelForNode(node: PMNode): string {
  if (node.type === 'item') {
    return String(node.attrs?.itemType ?? 'item').toUpperCase();
  }

  return String(node.attrs?.title ?? node.type.toUpperCase());
}

function readItemFields(itemNode: PMNode): ItemFieldModel[] {
  const itemFields = (itemNode.content ?? []).find((node) => node.type === 'itemFields');
  if (!itemFields?.content) {
    return [];
  }

  const fields: ItemFieldModel[] = [];

  for (const entry of itemFields.content) {
    if (entry.type === 'field') {
      fields.push(toItemFieldModel(entry));
      continue;
    }

    if (entry.type === 'fieldGroup') {
      const groupKey = String(entry.attrs?.groupKey ?? 'group');
      for (const groupedField of entry.content ?? []) {
        if (groupedField.type !== 'field') {
          continue;
        }
        fields.push({
          ...toItemFieldModel(groupedField),
          groupKey,
        });
      }
    }
  }

  return fields;
}

function toItemFieldModel(fieldNode: PMNode): ItemFieldModel {
  return {
    fieldId: String(fieldNode.attrs?.id ?? ''),
    key: String(fieldNode.attrs?.key ?? ''),
    valueType: fieldNode.attrs?.valueType as ValueType,
    value: (fieldNode.attrs?.value ?? null) as string | number | boolean | null,
  };
}

function collectPath(current: HierarchyNode, targetId: UUID, ancestors: UUID[]): boolean {
  if (current.id === targetId) {
    return true;
  }

  for (const child of current.children) {
    ancestors.push(current.id);
    const found = collectPath(child, targetId, ancestors);
    if (found) {
      return true;
    }
    ancestors.pop();
  }

  return false;
}

function walkNodes(node: SeriesDoc | PMNode, visit: (node: PMNode) => void): void {
  if ((node as PMNode).type) {
    visit(node as PMNode);
  }

  const content: PMNode[] | undefined = (node as PMNode | SeriesDoc).content;
  if (!content) {
    return;
  }

  for (const child of content) {
    walkNodes(child, visit);
  }
}

export const FIELD_SELECT_OPTIONS: Record<string, string[]> = {
  materialType: ['print', 'negative', 'slide', 'digital', 'other'],
  rightsStatus: ['public', 'restricted', 'copyright-undetermined'],
  condition: ['excellent', 'good', 'fair', 'poor'],
  digitizationStatus: ['not-digitized', 'digitized', 'born-digital'],
  height_unit: ['mm', 'cm', 'm', 'in', 'ft'],
  weight_unit: ['g', 'kg', 'oz', 'lb'],
};

export function getSelectOptions(field: ItemFieldModel): string[] {
  if (field.valueType !== 'select') {
    return [];
  }

  if (field.key === 'unit' && field.groupKey === 'height') {
    return FIELD_SELECT_OPTIONS.height_unit;
  }

  if (field.key === 'unit' && field.groupKey === 'weight') {
    return FIELD_SELECT_OPTIONS.weight_unit;
  }

  return FIELD_SELECT_OPTIONS[field.key] ?? [];
}

function findNodeById(node: SeriesDoc | PMNode, nodeId: UUID): PMNode | null {
  if ((node as PMNode).attrs?.id && String((node as PMNode).attrs?.id) === nodeId) {
    return node as PMNode;
  }

  const content = (node as PMNode | SeriesDoc).content;
  if (!content) {
    return null;
  }

  for (const child of content) {
    const found = findNodeById(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

function readNodeMetadata(node: PMNode): Record<string, string> {
  const output: Record<string, string> = {};
  const attrs = node.attrs ?? {};

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id' || key === 'title' || value == null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = String(value);
    }
  }

  return output;
}

type NodeLocation = {
  node: PMNode;
  parent: PMNode;
  index: number;
  path: number[];
  parentPath: number[];
};

function findNodeLocationById(
  node: SeriesDoc | PMNode,
  nodeId: UUID,
  parent: PMNode | null = null,
  path: number[] = [],
): NodeLocation | null {
  const asNode = node as PMNode;
  if (asNode.attrs?.id && String(asNode.attrs.id) === nodeId && parent) {
    const index = (parent.content ?? []).findIndex((entry) => entry === asNode);
    if (index >= 0) {
      return {
        node: asNode,
        parent,
        index,
        path,
        parentPath: path.slice(0, -1),
      };
    }
  }

  const content = (node as PMNode | SeriesDoc).content;
  if (!content) {
    return null;
  }

  for (let index = 0; index < content.length; index += 1) {
    const child = content[index];
    const found = findNodeLocationById(child, nodeId, asNode.type ? asNode : parent, [...path, index]);
    if (found) {
      return found;
    }
  }

  return null;
}

function getNodeAtPath(root: SeriesDoc | PMNode, path: number[]): SeriesDoc | PMNode | null {
  let current: SeriesDoc | PMNode | null = root;
  for (const index of path) {
    const content: PMNode[] | undefined = (current as SeriesDoc | PMNode).content;
    if (!content || index < 0 || index >= content.length) {
      return null;
    }
    current = content[index];
  }
  return current;
}

function isPathPrefix(ancestorPath: number[], candidatePath: number[]): boolean {
  if (ancestorPath.length >= candidatePath.length) {
    return false;
  }

  for (let index = 0; index < ancestorPath.length; index += 1) {
    if (ancestorPath[index] !== candidatePath[index]) {
      return false;
    }
  }

  return true;
}

function isTypedNode(node: SeriesDoc | PMNode): node is PMNode {
  return typeof (node as PMNode).type === 'string';
}

function canContainHierarchyNode(parentType: string, childType: string): boolean {
  if (parentType === 'series' || parentType === 'subseries') {
    return childType === 'subseries' || childType === 'file';
  }
  if (parentType === 'file') {
    return childType === 'item';
  }
  return false;
}

function isHierarchyBlockNode(type: string): boolean {
  return type === 'series' || type === 'subseries' || type === 'file' || type === 'item';
}

type HierarchyHeadingEntry = {
  id: UUID;
  level: HierarchyLevel;
  title: string;
  depth: number;
  pathLabel: string;
};

function flattenHierarchyHeadings(root: HierarchyNode): HierarchyHeadingEntry[] {
  const headings: HierarchyHeadingEntry[] = [];

  const walk = (node: HierarchyNode, depth: number, path: number[]) => {
    headings.push({
      id: node.id,
      level: node.level,
      title: node.title,
      depth,
      pathLabel: path.join('.'),
    });

    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      const childPath = depth === 0 ? [index + 1] : [...path, index + 1];
      walk(child, depth + 1, childPath);
    }
  };

  walk(root, 0, []);
  return headings;
}

function readSeriesBodySections(doc: SeriesDoc, fallbackFirstId?: UUID): Map<UUID, PMNode[]> {
  const content = getSeriesBodyNodes(doc);
  const sections = new Map<UUID, PMNode[]>();
  const leading: PMNode[] = [];
  let activeSectionId: UUID | null = null;

  for (const node of content) {
    if (isHierarchyHeadingNode(node)) {
      activeSectionId = String(node.attrs?.hierarchyId);
      if (!sections.has(activeSectionId)) {
        sections.set(activeSectionId, []);
      }
      continue;
    }

    if (!activeSectionId) {
      leading.push(structuredClone(node));
      continue;
    }

    const section = sections.get(activeSectionId) ?? [];
    section.push(structuredClone(node));
    sections.set(activeSectionId, section);
  }

  if (leading.length > 0) {
    const firstId = (sections.keys().next().value as UUID | undefined) ?? fallbackFirstId;
    if (firstId) {
      const existing = sections.get(firstId) ?? [];
      sections.set(firstId, [...leading, ...existing]);
    }
  }

  return sections;
}

function writeSeriesBodySections(doc: SeriesDoc, sections: Map<UUID, PMNode[]>): SeriesDoc {
  const headings = flattenHierarchyHeadings(buildHierarchyTree(doc));
  const nextContent: PMNode[] = [];

  for (const heading of headings) {
    nextContent.push(buildHierarchySectionHeadingNode(heading));

    const sectionNodes = sections.get(heading.id) ?? [];
    for (const node of sectionNodes) {
      nextContent.push(structuredClone(node));
    }
  }

  return setSeriesBodyNodes(doc, nextContent);
}

function buildHierarchySectionHeadingNode(heading: HierarchyHeadingEntry): PMNode {
  const level = Math.max(1, Math.min(heading.depth + 1, 3)) as 1 | 2 | 3;
  const labelPrefix = heading.pathLabel.length > 0 ? `${heading.pathLabel} ` : '';
  return {
    type: 'heading',
    attrs: {
      level,
      hierarchyId: heading.id,
      hierarchyDepth: heading.depth,
      hierarchyLevel: heading.level,
    },
    content: [
      {
        type: 'text',
        text: `${labelPrefix}${heading.title}`,
      },
    ],
  };
}

function isHierarchyHeadingNode(node: PMNode): boolean {
  return node.type === 'heading' && node.attrs?.hierarchyId != null;
}

function createHierarchyNode(
  level: HierarchyLevel,
  options?: { id?: UUID; title?: string; itemType?: ItemType },
): PMNode {
  const id = options?.id ?? createNodeId(level);
  const title = options?.title ?? defaultTitleForLevel(level);

  if (level === 'subseries') {
    return {
      type: 'subseries',
      attrs: { id, title },
      content: [],
    };
  }

  if (level === 'file') {
    return {
      type: 'file',
      attrs: { id, title },
      content: [],
    };
  }

  if (level === 'item') {
    return {
      type: 'item',
      attrs: {
        id,
        itemType: options?.itemType ?? 'document',
      },
      content: [
        {
          type: 'itemFields',
          content: [
            {
              type: 'field',
              attrs: {
                id: createNodeId('field'),
                key: 'title',
                valueType: 'text',
                value: '',
              },
            },
          ],
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

  return {
    type: 'subseries',
    attrs: { id, title },
    content: [],
  };
}

function defaultTitleForLevel(level: HierarchyLevel): string {
  if (level === 'subseries') {
    return 'New Subseries';
  }
  if (level === 'file') {
    return 'New File';
  }
  return 'New Item';
}

function createNodeId(prefix: string): UUID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
