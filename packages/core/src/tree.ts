import type { PMDoc, PMNode } from './types';

export type NodePath = number[];

export type NodeLocation = {
  node: PMNode;
  path: NodePath;
  parent: PMNode | PMDoc;
  parentPath: NodePath;
  index: number;
};

export function cloneDoc<T>(value: T): T {
  return structuredClone(value);
}

export function walkNodes(
  node: PMNode | PMDoc,
  visit: (node: PMNode, path: NodePath, parent: PMNode | PMDoc | null) => void,
  path: NodePath = [],
  parent: PMNode | PMDoc | null = null,
): void {
  if ((node as PMNode).type) {
    visit(node as PMNode, path, parent);
  }
  const content = (node as PMNode | PMDoc).content;
  if (!content) {
    return;
  }
  for (let i = 0; i < content.length; i += 1) {
    walkNodes(content[i], visit, [...path, i], node);
  }
}

export function getNodeAtPath(root: PMDoc | PMNode, path: NodePath): PMNode | PMDoc | null {
  let current: any = root;
  for (const idx of path) {
    if (!current?.content || idx < 0 || idx >= current.content.length) {
      return null;
    }
    current = current.content[idx];
  }
  return current as PMNode | PMDoc;
}

export function findNodeById(
  root: PMDoc | PMNode,
  id: string,
  allowedTypes?: string[],
): NodeLocation | null {
  let found: NodeLocation | null = null;
  walkNodes(root, (node, path, parent) => {
    if (found) {
      return;
    }
    if (!node.attrs || node.attrs.id !== id) {
      return;
    }
    if (allowedTypes && !allowedTypes.includes(node.type)) {
      return;
    }
    if (!parent) {
      return;
    }
    const index = path[path.length - 1] ?? 0;
    found = {
      node,
      path,
      parent,
      parentPath: path.slice(0, -1),
      index,
    };
  });
  return found;
}

export function findSuggestionBlockBySid(root: PMDoc | PMNode, sid: string): NodeLocation | null {
  let found: NodeLocation | null = null;
  walkNodes(root, (node, path, parent) => {
    if (found) {
      return;
    }
    if (node.type !== 'suggestion_block') {
      return;
    }
    if (node.attrs?.sid !== sid) {
      return;
    }
    if (!parent) {
      return;
    }
    const index = path[path.length - 1] ?? 0;
    found = {
      node,
      path,
      parent,
      parentPath: path.slice(0, -1),
      index,
    };
  });
  return found;
}

export function removeNodeAtPath(root: PMDoc | PMNode, path: NodePath): PMNode | null {
  const index = path[path.length - 1];
  if (index == null) {
    return null;
  }
  const parent = getNodeAtPath(root, path.slice(0, -1));
  if (!parent || !(parent as any).content) {
    return null;
  }
  const content = (parent as any).content as PMNode[];
  if (index < 0 || index >= content.length) {
    return null;
  }
  const [removed] = content.splice(index, 1);
  return removed ?? null;
}

export function insertNodeAt(
  root: PMDoc | PMNode,
  parentPath: NodePath,
  index: number,
  node: PMNode,
): boolean {
  const parent = getNodeAtPath(root, parentPath);
  if (!parent || !(parent as any).content) {
    return false;
  }
  const content = (parent as any).content as PMNode[];
  const safeIndex = Math.max(0, Math.min(index, content.length));
  content.splice(safeIndex, 0, node);
  return true;
}

export function removeSuggestionBlocksBySid(root: PMDoc | PMNode, sid: string): number {
  let removed = 0;
  const prune = (node: PMNode | PMDoc): void => {
    if (!node.content) {
      return;
    }
    const next: PMNode[] = [];
    for (const child of node.content) {
      if (child.type === 'suggestion_block' && child.attrs?.sid === sid) {
        removed += 1;
        continue;
      }
      prune(child);
      next.push(child);
    }
    node.content = next;
  };
  prune(root);
  return removed;
}

export function hasNodeId(root: PMDoc | PMNode, id: string): boolean {
  return !!findNodeById(root, id);
}

export function nodeChildren(node: PMNode): PMNode[] {
  if (!node.content) {
    node.content = [];
  }
  return node.content;
}
