import { useCallback, useMemo } from 'react';
import {
  HierarchyTreeWidget,
  type HierarchyWidgetMovePlacement,
  type HierarchyWidgetRow,
} from '@archival/hierarchy-widget';

import {
  collectAncestorIds,
  isExpandedByPolicy,
  type FocusState,
  type HierarchyLevel,
  type HierarchyNode,
} from '../lib/series';
import { userInitials } from '../lib/user';

type PresenceUser = { id: string; name: string; color: string };

type SeriesOption = {
  docName: string;
  title: string;
  presenceCount: number;
};

type FindingAidHierarchyProps = {
  root: HierarchyNode;
  focusState: FocusState;
  seriesOptions?: SeriesOption[];
  activeSeriesDocName?: string;
  onSelectSeries?: (docName: string) => void;
  onFocus: (id: string) => void;
  onJumpToDocument?: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onMove: (draggedId: string, targetId: string, placement: HierarchyWidgetMovePlacement) => void;
  onMoveSeries?: (draggedDocName: string, targetDocName: string, placement: HierarchyWidgetMovePlacement) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onAddChild: (parentId: string, level: HierarchyLevel) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  presenceByNodeId?: Record<string, PresenceUser[]>;
};

type OutlineEntry = {
  id: string;
  parentId: string | null;
  level: HierarchyLevel;
  depth: number;
  title: string;
  hasChildren: boolean;
  expanded: boolean;
  isFocused: boolean;
  pathLabel: string;
  kind: 'node' | 'seriesRef';
  seriesDocName?: string;
  seriesPresenceCount?: number;
  isActiveSeries?: boolean;
};

type SiblingMeta = {
  prevId: string | null;
  nextId: string | null;
};

const LEVEL_LABELS: Record<HierarchyLevel, string> = {
  series: 'Series',
  subseries: 'Subseries',
  file: 'File',
  item: 'Item',
};

export function FindingAidHierarchy({
  root,
  focusState,
  seriesOptions = [],
  activeSeriesDocName,
  onSelectSeries,
  onFocus,
  onJumpToDocument,
  onToggleExpand,
  onMove,
  onMoveSeries,
  onIndent,
  onOutdent,
  onAddChild,
  onDelete,
  onRename,
  presenceByNodeId = {},
}: FindingAidHierarchyProps) {
  const focusedAncestors = useMemo(
    () => collectAncestorIds(root, focusState.focusedId),
    [root, focusState.focusedId],
  );

  const outline = useMemo(() => {
    const activeOutline = flattenVisibleHierarchy(root, focusState, focusedAncestors);
    if (seriesOptions.length === 0 || !activeSeriesDocName) {
      return activeOutline;
    }

    const activeRoot = activeOutline[0] ?? null;
    const activeDescendants = activeOutline
      .slice(1)
      .map((entry) => ({ ...entry, seriesDocName: activeSeriesDocName }));

    let hasActiveSeriesRow = false;
    const seriesRows: OutlineEntry[] = seriesOptions.map((series, index): OutlineEntry => {
      const isActiveSeries = series.docName === activeSeriesDocName;
      if (isActiveSeries && activeRoot) {
        hasActiveSeriesRow = true;
        return {
          ...activeRoot,
          pathLabel: String(index + 1),
          isActiveSeries: true,
          seriesDocName: series.docName,
          seriesPresenceCount: series.presenceCount,
        };
      }

      return {
        id: `series-ref:${series.docName}`,
        parentId: null,
        level: 'series',
        depth: 0,
        title: series.title,
        hasChildren: true,
        expanded: false,
        isFocused: false,
        pathLabel: String(index + 1),
        kind: 'seriesRef',
        seriesDocName: series.docName,
        seriesPresenceCount: series.presenceCount,
        isActiveSeries,
      };
    });

    const stitched: OutlineEntry[] = [];
    if (!hasActiveSeriesRow && activeRoot) {
      const activeOptionIndex = seriesOptions.findIndex((series) => series.docName === activeSeriesDocName);
      stitched.push({
        ...activeRoot,
        isActiveSeries: true,
        seriesDocName: activeSeriesDocName,
        seriesPresenceCount:
          activeOptionIndex >= 0 ? seriesOptions[activeOptionIndex]?.presenceCount : activeRoot.seriesPresenceCount,
        pathLabel: activeOptionIndex >= 0 ? String(activeOptionIndex + 1) : activeRoot.pathLabel,
      });
      stitched.push(...activeDescendants);
      stitched.push(...seriesRows);
      return stitched;
    }

    for (const row of seriesRows) {
      stitched.push(row);
      if (row.isActiveSeries) {
        stitched.push(...activeDescendants);
      }
    }

    return stitched;
  }, [root, focusState, focusedAncestors, seriesOptions, activeSeriesDocName]);

  const outlineById = useMemo(() => {
    const map = new Map<string, OutlineEntry>();
    for (const entry of outline) {
      map.set(entry.id, entry);
    }
    return map;
  }, [outline]);

  const siblingOrderByParent = useMemo(() => {
    const groups = new Map<string, OutlineEntry[]>();
    for (const entry of outline) {
      const key = `${entry.parentId ?? 'root'}::${entry.level}`;
      const current = groups.get(key) ?? [];
      current.push(entry);
      groups.set(key, current);
    }
    return groups;
  }, [outline]);

  const siblingMetaById = useMemo(() => {
    const map = new Map<string, SiblingMeta>();
    for (const siblings of siblingOrderByParent.values()) {
      for (let index = 0; index < siblings.length; index += 1) {
        const current = siblings[index];
        if (!current) {
          continue;
        }

        map.set(current.id, {
          prevId: siblings[index - 1]?.id ?? null,
          nextId: siblings[index + 1]?.id ?? null,
        });
      }
    }
    return map;
  }, [siblingOrderByParent]);

  const canDrop = useCallback(
    (sourceId: string, targetId: string, placement: HierarchyWidgetMovePlacement): boolean => {
      if (sourceId === targetId) {
        return false;
      }

      const source = outlineById.get(sourceId);
      const target = outlineById.get(targetId);
      if (!source || !target) {
        return false;
      }

      const sourceIsSeriesRow = isSeriesRowEntry(source);
      const targetIsSeriesRow = isSeriesRowEntry(target);

      if (sourceIsSeriesRow || targetIsSeriesRow) {
        if (!sourceIsSeriesRow || !targetIsSeriesRow || !onMoveSeries) {
          return false;
        }

        const key = 'root::series';
        const siblings = siblingOrderByParent.get(key) ?? [];
        const fromIndex = siblings.findIndex((entry) => entry.id === sourceId);
        const targetIndex = siblings.findIndex((entry) => entry.id === targetId);

        if (fromIndex < 0 || targetIndex < 0) {
          return false;
        }

        let insertIndex = placement === 'before' ? targetIndex : targetIndex + 1;
        if (fromIndex < insertIndex) {
          insertIndex -= 1;
        }

        return insertIndex !== fromIndex;
      }

      if (source.kind !== 'node' || target.kind !== 'node' || source.depth === 0 || source.level !== target.level) {
        return false;
      }

      if (source.parentId !== target.parentId) {
        return true;
      }

      const key = `${source.parentId ?? 'root'}::${source.level}`;
      const siblings = siblingOrderByParent.get(key) ?? [];
      const fromIndex = siblings.findIndex((entry) => entry.id === sourceId);
      const targetIndex = siblings.findIndex((entry) => entry.id === targetId);

      if (fromIndex < 0 || targetIndex < 0) {
        return false;
      }

      let insertIndex = placement === 'before' ? targetIndex : targetIndex + 1;
      if (fromIndex < insertIndex) {
        insertIndex -= 1;
      }

      return insertIndex !== fromIndex;
    },
    [onMoveSeries, outlineById, siblingOrderByParent],
  );

  const moveToEndTarget = useCallback(
    (sourceId: string): { targetId: string; placement: HierarchyWidgetMovePlacement } | null => {
      const source = outlineById.get(sourceId);
      if (!source) {
        return null;
      }

      if (isSeriesRowEntry(source)) {
        if (!onMoveSeries) {
          return null;
        }

        const siblings = siblingOrderByParent.get('root::series') ?? [];
        if (siblings.length <= 1) {
          return null;
        }

        const last = siblings[siblings.length - 1];
        if (!last || last.id === sourceId) {
          return null;
        }

        return { targetId: last.id, placement: 'after' };
      }

      if (source.kind !== 'node' || source.depth === 0) {
        return null;
      }

      const key = `${source.parentId ?? 'root'}::${source.level}`;
      const siblings = siblingOrderByParent.get(key) ?? [];
      if (siblings.length <= 1) {
        return null;
      }

      const last = siblings[siblings.length - 1];
      if (!last || last.id === sourceId) {
        return null;
      }

      return { targetId: last.id, placement: 'after' };
    },
    [onMoveSeries, outlineById, siblingOrderByParent],
  );

  const handleMove = useCallback(
    (sourceId: string, targetId: string, placement: HierarchyWidgetMovePlacement) => {
      const source = outlineById.get(sourceId);
      const target = outlineById.get(targetId);
      if (!source || !target) {
        return;
      }

      const sourceIsSeriesRow = isSeriesRowEntry(source);
      const targetIsSeriesRow = isSeriesRowEntry(target);
      if (
        sourceIsSeriesRow &&
        targetIsSeriesRow &&
        source.seriesDocName &&
        target.seriesDocName &&
        onMoveSeries
      ) {
        onMoveSeries(source.seriesDocName, target.seriesDocName, placement);
        return;
      }

      onMove(sourceId, targetId, placement);
    },
    [onMove, onMoveSeries, outlineById],
  );

  const rows = useMemo<HierarchyWidgetRow[]>(() => {
    return outline.map((entry) => {
      const isNodeEntry = entry.kind === 'node';
      const isSeriesRow = entry.level === 'series' && entry.depth === 0;
      const siblingMeta = siblingMetaById.get(entry.id) ?? { prevId: null, nextId: null };
      const addChildOptions = getAddChildLevelOptions(entry.level).map((level) => ({
        level,
        label: `Add ${LEVEL_LABELS[level]}`,
      }));

      return {
        id: entry.id,
        parentId: entry.parentId,
        level: entry.level,
        depth: entry.depth,
        title: entry.title,
        hasChildren: entry.hasChildren,
        expanded: entry.expanded,
        pathLabel: entry.pathLabel,
        kind: entry.kind,
        isSelected: entry.isFocused || Boolean(entry.isActiveSeries && entry.depth === 0),
        isActiveSeries: entry.isActiveSeries,
        seriesDocName: entry.seriesDocName,
        seriesPresenceCount: entry.seriesPresenceCount,
        presence: isNodeEntry ? presenceByNodeId[entry.id] ?? [] : [],
        canDrag: (isNodeEntry && entry.depth > 0) || isSeriesRow,
        canRename: isNodeEntry && entry.level !== 'item' && Boolean(onRename),
        canIndent: computeCanIndent(entry, outlineById, siblingMetaById),
        canOutdent: computeCanOutdent(entry, outlineById),
        canDelete: entry.depth > 0,
        moveUpTargetId: entry.depth > 0 ? siblingMeta.prevId : null,
        moveDownTargetId: entry.depth > 0 ? siblingMeta.nextId : null,
        addChildOptions,
      };
    });
  }, [onRename, outline, outlineById, presenceByNodeId, siblingMetaById]);

  return (
    <HierarchyTreeWidget
      rows={rows}
      onFocusNode={(id) => {
        onFocus(id);
        onJumpToDocument?.(id);
      }}
      onSelectSeries={onSelectSeries}
      onToggleExpand={onToggleExpand}
      onMove={handleMove}
      canDrop={canDrop}
      canDropToEnd={moveToEndTarget}
      onRename={onRename}
      onIndent={onIndent}
      onOutdent={onOutdent}
      onAddChild={(parentId, level) => {
        if (!isHierarchyLevel(level)) {
          return;
        }
        onAddChild(parentId, level);
      }}
      onDelete={onDelete}
      getUserInitials={userInitials}
    />
  );
}

function isSeriesRowEntry(entry: OutlineEntry): boolean {
  return entry.level === 'series' && entry.depth === 0 && Boolean(entry.seriesDocName);
}

function isHierarchyLevel(value: string): value is HierarchyLevel {
  return value === 'series' || value === 'subseries' || value === 'file' || value === 'item';
}

function flattenVisibleHierarchy(
  root: HierarchyNode,
  focusState: FocusState,
  focusedAncestors: Set<string>,
): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  const walk = (
    node: HierarchyNode,
    depth: number,
    parentId: string | null,
    path: number[],
  ) => {
    const expanded = isExpandedByPolicy(node.id, focusState, focusedAncestors);
    entries.push({
      id: node.id,
      parentId,
      level: node.level,
      depth,
      title: node.title,
      hasChildren: node.children.length > 0,
      expanded,
      isFocused: focusState.focusedId === node.id,
      pathLabel: path.join('.'),
      kind: 'node',
      isActiveSeries: depth === 0,
    });

    if (!expanded) {
      return;
    }

    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      const childPath = depth === 0 ? [index + 1] : [...path, index + 1];
      walk(child, depth + 1, node.id, childPath);
    }
  };

  walk(root, 0, null, []);
  return entries;
}

function computeCanIndent(
  entry: OutlineEntry,
  outlineById: Map<string, OutlineEntry>,
  siblingMetaById: Map<string, SiblingMeta>,
): boolean {
  if (entry.kind !== 'node' || entry.depth === 0) {
    return false;
  }

  const siblingMeta = siblingMetaById.get(entry.id);
  if (!siblingMeta?.prevId) {
    return false;
  }

  const previous = outlineById.get(siblingMeta.prevId);
  if (!previous || previous.kind !== 'node') {
    return false;
  }

  return canContainHierarchyLevel(previous.level, entry.level);
}

function computeCanOutdent(entry: OutlineEntry, outlineById: Map<string, OutlineEntry>): boolean {
  if (entry.kind !== 'node' || entry.depth <= 1 || !entry.parentId) {
    return false;
  }

  const parent = outlineById.get(entry.parentId);
  if (!parent || parent.kind !== 'node' || !parent.parentId) {
    return false;
  }

  const grandParent = outlineById.get(parent.parentId);
  if (!grandParent || grandParent.kind !== 'node') {
    return false;
  }

  return canContainHierarchyLevel(grandParent.level, entry.level);
}

function canContainHierarchyLevel(parent: HierarchyLevel, child: HierarchyLevel): boolean {
  if (parent === 'series' || parent === 'subseries') {
    return child === 'subseries' || child === 'file';
  }
  if (parent === 'file') {
    return child === 'item';
  }
  return false;
}

function getAddChildLevelOptions(level: HierarchyLevel): HierarchyLevel[] {
  if (level === 'series' || level === 'subseries') {
    return ['subseries', 'file'];
  }
  if (level === 'file') {
    return ['item'];
  }
  return [];
}
