import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  onToggleExpand: (id: string) => void;
  onMove: (draggedId: string, targetId: string, placement: 'before' | 'after') => void;
  onMoveSeries?: (draggedDocName: string, targetDocName: string, placement: 'before' | 'after') => void;
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

type DropTarget = {
  id: string;
  placement: 'before' | 'after';
};

type SiblingMeta = {
  prevId: string | null;
  nextId: string | null;
};

const LEVEL_LABELS: Record<HierarchyLevel, string> = {
  series: 'Series',
  subseries: 'Subseries',
  box: 'Box',
  file: 'File',
  item: 'Item',
};

const LEVEL_COLORS: Record<HierarchyLevel, string> = {
  series: '#ff5757',
  subseries: '#ff5757',
  box: '#8b5cf6',
  file: '#3b82f6',
  item: '#6b7280',
};

export function FindingAidHierarchy({
  root,
  focusState,
  seriesOptions = [],
  activeSeriesDocName,
  onSelectSeries,
  onFocus,
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

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const pointerDraggedIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dropEnd, setDropEnd] = useState(false);
  const [addMenuOpenId, setAddMenuOpenId] = useState<string | null>(null);
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);

  const beginPointerDrag = (
    event: ReactPointerEvent,
    nodeId: string,
    depth: number,
    allowDepthZero: boolean = false,
  ) => {
    if (depth === 0 && !allowDepthZero) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, button, a')) {
      return;
    }

    pointerDraggedIdRef.current = nodeId;
    setDraggedId(nodeId);
    setDropTarget(null);
    setDropEnd(false);
    setAddMenuOpenId(null);
    setActionMenuOpenId(null);
    event.preventDefault();
  };

  const endPointerDrag = () => {
    pointerDraggedIdRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
    setDropEnd(false);
  };

  const canDrop = (sourceId: string, targetId: string, placement: 'before' | 'after'): boolean => {
    if (sourceId === targetId) {
      return false;
    }

    const source = outlineById.get(sourceId);
    const target = outlineById.get(targetId);
    if (!source || !target) {
      return false;
    }

    const sourceIsSeriesRow = source.level === 'series' && source.depth === 0 && Boolean(source.seriesDocName);
    const targetIsSeriesRow = target.level === 'series' && target.depth === 0 && Boolean(target.seriesDocName);

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
  };

  const moveToEndTarget = (sourceId: string): { targetId: string; placement: 'after' } | null => {
    const source = outlineById.get(sourceId);
    if (!source) {
      return null;
    }

    const sourceIsSeriesRow = source.level === 'series' && source.depth === 0 && Boolean(source.seriesDocName);
    if (sourceIsSeriesRow) {
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
  };

  const resolvePlacementFromClientY = (clientY: number, rect: DOMRect): 'before' | 'after' =>
    clientY < rect.top + rect.height / 2 ? 'before' : 'after';

  useEffect(() => {
    if (!draggedId) {
      return;
    }

    const resolveDropFromPointer = (clientX: number, clientY: number): DropTarget | null => {
      const sourceId = pointerDraggedIdRef.current ?? draggedId;
      if (!sourceId) {
        return null;
      }

      const hovered = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const row = hovered?.closest<HTMLElement>('[data-hierarchy-row-id]');
      const targetId = row?.dataset.hierarchyRowId;
      if (!row || !targetId) {
        return null;
      }

      const placement = resolvePlacementFromClientY(clientY, row.getBoundingClientRect());
      if (!canDrop(sourceId, targetId, placement)) {
        return null;
      }

      return { id: targetId, placement };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const sourceId = pointerDraggedIdRef.current ?? draggedId;
      if (!sourceId) {
        return;
      }

      const maybeDrop = resolveDropFromPointer(event.clientX, event.clientY);
      if (maybeDrop) {
        setDropEnd(false);
        if (dropTarget?.id !== maybeDrop.id || dropTarget.placement !== maybeDrop.placement) {
          setDropTarget(maybeDrop);
        }
        return;
      }

      const hovered = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const onEndZone = hovered?.closest('.finding-hierarchy__outline-drop-end');
      if (onEndZone && moveToEndTarget(sourceId)) {
        if (dropTarget) {
          setDropTarget(null);
        }
        if (!dropEnd) {
          setDropEnd(true);
        }
        return;
      }

      if (dropTarget) {
        setDropTarget(null);
      }
      if (dropEnd) {
        setDropEnd(false);
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const sourceId = pointerDraggedIdRef.current ?? draggedId;
      if (!sourceId) {
        endPointerDrag();
        return;
      }

      const maybeDrop = resolveDropFromPointer(event.clientX, event.clientY);
      if (maybeDrop) {
        const sourceEntry = outlineById.get(sourceId);
        const targetEntry = outlineById.get(maybeDrop.id);
        const sourceIsSeriesRow =
          sourceEntry?.level === 'series' && sourceEntry.depth === 0 && Boolean(sourceEntry.seriesDocName);
        const targetIsSeriesRow =
          targetEntry?.level === 'series' && targetEntry.depth === 0 && Boolean(targetEntry.seriesDocName);

        if (
          sourceIsSeriesRow &&
          targetIsSeriesRow &&
          sourceEntry?.seriesDocName &&
          targetEntry?.seriesDocName &&
          onMoveSeries
        ) {
          onMoveSeries(sourceEntry.seriesDocName, targetEntry.seriesDocName, maybeDrop.placement);
        } else {
          onMove(sourceId, maybeDrop.id, maybeDrop.placement);
        }
        endPointerDrag();
        return;
      }

      if (dropEnd) {
        const moveTarget = moveToEndTarget(sourceId);
        if (moveTarget) {
          const sourceEntry = outlineById.get(sourceId);
          const targetEntry = outlineById.get(moveTarget.targetId);
          const sourceIsSeriesRow =
            sourceEntry?.level === 'series' && sourceEntry.depth === 0 && Boolean(sourceEntry.seriesDocName);
          const targetIsSeriesRow =
            targetEntry?.level === 'series' && targetEntry.depth === 0 && Boolean(targetEntry.seriesDocName);

          if (
            sourceIsSeriesRow &&
            targetIsSeriesRow &&
            sourceEntry?.seriesDocName &&
            targetEntry?.seriesDocName &&
            onMoveSeries
          ) {
            onMoveSeries(sourceEntry.seriesDocName, targetEntry.seriesDocName, moveTarget.placement);
          } else {
            onMove(sourceId, moveTarget.targetId, moveTarget.placement);
          }
        }
      }

      endPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [canDrop, draggedId, dropEnd, dropTarget, moveToEndTarget, onMove, onMoveSeries, outlineById]);

  return (
    <div className="finding-hierarchy" aria-label="Guided processing hierarchy">
      <div className="finding-hierarchy__levels">
        {(['series', 'subseries', 'box', 'file', 'item'] as const).map((level) => (
          <span key={level} className="finding-hierarchy__level-chip">
            <span className="finding-hierarchy__level-dot" style={{ backgroundColor: LEVEL_COLORS[level] }} />
            {LEVEL_LABELS[level]}
          </span>
        ))}
      </div>

      <div className="finding-hierarchy__outline">
        <div className="finding-hierarchy__outline-header">
          <div className="finding-hierarchy__outline-title">Hierarchy</div>
          <div className="finding-hierarchy__outline-sub">Drag rows to reorder siblings</div>
        </div>

        <div className="finding-hierarchy__outline-list" role="tree">
          {outline.map((entry) => {
            const isSeriesRef = entry.kind === 'seriesRef';
            const isNodeEntry = entry.kind === 'node';
            const isSeriesRow = entry.level === 'series' && entry.depth === 0;
            const canDragRow = (isNodeEntry && entry.depth > 0) || isSeriesRow;
            const isSelected = entry.isFocused || Boolean(entry.isActiveSeries && entry.depth === 0);
            const isDropTarget = dropTarget?.id === entry.id;
            const isDragging = draggedId === entry.id;
            const dropBefore = isDropTarget && dropTarget?.placement === 'before';
            const dropAfter = isDropTarget && dropTarget?.placement === 'after';
            const presence = isNodeEntry ? presenceByNodeId[entry.id] ?? [] : [];
            const isRenameable = isNodeEntry && entry.level !== 'item' && typeof onRename === 'function';
            const siblingMeta = siblingMetaById.get(entry.id) ?? { prevId: null, nextId: null };
            const canIndent = computeCanIndent(entry, outlineById, siblingMetaById);
            const canOutdent = computeCanOutdent(entry, outlineById);
            const addChildOptions = getAddChildLevelOptions(entry.level);

            return (
              <div key={entry.id} className="finding-hierarchy__entry-wrap">
                {dropBefore ? <div className="finding-hierarchy__drop-line" aria-hidden /> : null}

                <div
                  className={`finding-hierarchy__outline-item ${isSelected ? 'is-selected' : ''} ${entry.isActiveSeries ? 'is-series-active' : ''} ${isDropTarget ? 'finding-hierarchy__drop-target' : ''} ${isDragging ? 'is-dragging' : ''}`}
                  style={{ marginLeft: entry.depth * 12 }}
                  data-hierarchy-row-id={entry.id}
                  role="treeitem"
                  aria-expanded={entry.hasChildren ? entry.expanded : undefined}
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest('input, textarea, select, button, a')) {
                      return;
                    }
                    if (isSeriesRef) {
                      if (entry.seriesDocName) {
                        onSelectSeries?.(entry.seriesDocName);
                      }
                      setAddMenuOpenId(null);
                      setActionMenuOpenId(null);
                      return;
                    }

                    onFocus(entry.id);
                    setAddMenuOpenId(null);
                    setActionMenuOpenId(null);
                    beginPointerDrag(event, entry.id, entry.depth, false);
                  }}
                >
                  <button
                    type="button"
                    className={
                      entry.hasChildren
                        ? 'finding-hierarchy__expand'
                        : 'finding-hierarchy__expand finding-hierarchy__expand--hidden'
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!entry.hasChildren) {
                        return;
                      }

                      if (isSeriesRef) {
                        if (entry.seriesDocName) {
                          onSelectSeries?.(entry.seriesDocName);
                        }
                        return;
                      }

                      onToggleExpand(entry.id);
                    }}
                    aria-label={entry.expanded ? 'Collapse node' : 'Expand node'}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ transform: entry.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      aria-hidden
                    >
                      <path d="M8 5l8 7-8 7V5z" />
                    </svg>
                  </button>

                  <div
                    className={
                      !canDragRow
                        ? 'finding-hierarchy__drag finding-hierarchy__drag--disabled'
                        : 'finding-hierarchy__drag'
                    }
                    onPointerDown={(event) => {
                      if (!canDragRow) {
                        return;
                      }
                      event.stopPropagation();
                      if (!isSeriesRef) {
                        onFocus(entry.id);
                      }
                      setAddMenuOpenId(null);
                      setActionMenuOpenId(null);
                      beginPointerDrag(event, entry.id, entry.depth, isSeriesRow);
                    }}
                    aria-label="Drag to reorder sibling"
                    title="Drag to reorder sibling"
                  >
                    <span className="finding-hierarchy__grip" />
                  </div>

                  <div className="finding-hierarchy__pill" style={{ '--level-color': LEVEL_COLORS[entry.level] } as CSSProperties}>
                    <div className="finding-hierarchy__pill-main">
                      <div className="finding-hierarchy__pill-left">
                        <span className="finding-hierarchy__pill-level-name">{LEVEL_LABELS[entry.level]}</span>
                        {entry.pathLabel.length > 0 ? (
                          <span className="finding-hierarchy__pill-number">{entry.pathLabel}</span>
                        ) : null}
                      </div>
                      <div className="finding-hierarchy__pill-divider" />

                      {isRenameable ? (
                        <input
                          value={entry.title}
                          onFocus={() => onFocus(entry.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onRename(entry.id, event.target.value)}
                        />
                      ) : (
                        <span className="finding-hierarchy__pill-name" title={entry.title}>
                          {entry.title}
                        </span>
                      )}
                    </div>

                    <div className="finding-hierarchy__pill-actions">
                      {entry.seriesPresenceCount != null ? (
                        <span className="finding-hierarchy__series-count">
                          {entry.seriesPresenceCount} active {entry.seriesPresenceCount === 1 ? 'user' : 'users'}
                        </span>
                      ) : null}
                      {presence.length > 0 ? (
                        <span className="finding-hierarchy__presence" aria-label={`${presence.length} collaborators focused here`}>
                          {presence.map((person) => (
                            <span
                              key={person.id}
                              className="finding-hierarchy__presence-chip"
                              style={{ backgroundColor: person.color }}
                              title={`${person.name} focused`}
                            >
                              {userInitials(person.name)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {isNodeEntry ? (
                        <button
                          type="button"
                          className="finding-hierarchy__menu-trigger"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onFocus(entry.id);
                            setAddMenuOpenId(null);
                            setActionMenuOpenId((current) => (current === entry.id ? null : entry.id));
                          }}
                          aria-label="Open row actions"
                          aria-expanded={actionMenuOpenId === entry.id}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="6" cy="12" r="1.9" fill="currentColor" />
                            <circle cx="12" cy="12" r="1.9" fill="currentColor" />
                            <circle cx="18" cy="12" r="1.9" fill="currentColor" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isNodeEntry && actionMenuOpenId === entry.id ? (
                    <div
                      className="finding-hierarchy__row-popover"
                      role="toolbar"
                      aria-label="Row actions"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {entry.depth > 0 ? (
                        <>
                          <button
                            type="button"
                            className="finding-hierarchy__action"
                            disabled={!siblingMeta.prevId}
                            onClick={() => {
                              if (siblingMeta.prevId) {
                                onMove(entry.id, siblingMeta.prevId, 'before');
                                onFocus(entry.id);
                                setAddMenuOpenId(null);
                                setActionMenuOpenId(null);
                              }
                            }}
                          >
                            Move Up
                          </button>
                          <button
                            type="button"
                            className="finding-hierarchy__action"
                            disabled={!siblingMeta.nextId}
                            onClick={() => {
                              if (siblingMeta.nextId) {
                                onMove(entry.id, siblingMeta.nextId, 'after');
                                onFocus(entry.id);
                                setAddMenuOpenId(null);
                                setActionMenuOpenId(null);
                              }
                            }}
                          >
                            Move Down
                          </button>
                          <button
                            type="button"
                            className="finding-hierarchy__action"
                            disabled={!canOutdent}
                            onClick={() => {
                              onOutdent(entry.id);
                              onFocus(entry.id);
                              setAddMenuOpenId(null);
                              setActionMenuOpenId(null);
                            }}
                          >
                            Outdent
                          </button>
                          <button
                            type="button"
                            className="finding-hierarchy__action"
                            disabled={!canIndent}
                            onClick={() => {
                              onIndent(entry.id);
                              onFocus(entry.id);
                              setAddMenuOpenId(null);
                              setActionMenuOpenId(null);
                            }}
                          >
                            Indent
                          </button>
                        </>
                      ) : null}
                      <div className="finding-hierarchy__add-wrap">
                        <button
                          type="button"
                          className="finding-hierarchy__action finding-hierarchy__add-btn"
                          title="Add child level"
                          aria-label="Add child level"
                          aria-expanded={addMenuOpenId === entry.id}
                          disabled={addChildOptions.length === 0}
                          onClick={() => {
                            if (addChildOptions.length === 0) {
                              return;
                            }
                            setAddMenuOpenId((current) => (current === entry.id ? null : entry.id));
                          }}
                        >
                          +
                        </button>

                        {addMenuOpenId === entry.id ? (
                          <div className="finding-hierarchy__add-menu" role="menu">
                            {addChildOptions.map((level) => (
                              <button
                                key={`${entry.id}-${level}`}
                                type="button"
                                role="menuitem"
                                className="finding-hierarchy__add-menu-item"
                                onClick={() => {
                                  onAddChild(entry.id, level);
                                  setAddMenuOpenId(null);
                                  setActionMenuOpenId(null);
                                }}
                              >
                                Add {LEVEL_LABELS[level]}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className="finding-hierarchy__action finding-hierarchy__delete-btn"
                        disabled={entry.depth === 0}
                          onClick={() => {
                            if (entry.depth === 0) {
                              return;
                            }
                            onDelete(entry.id);
                            setAddMenuOpenId(null);
                            setActionMenuOpenId(null);
                          }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>

                {dropAfter ? <div className="finding-hierarchy__drop-line" aria-hidden /> : null}
              </div>
            );
          })}

          <div
            className={`finding-hierarchy__outline-drop-end ${dropEnd ? 'is-drop-target' : ''}`}
            aria-hidden
          >
            {dropEnd ? <div className="finding-hierarchy__drop-slot" aria-hidden /> : null}
          </div>
        </div>
      </div>
    </div>
  );
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
    return child === 'subseries' || child === 'box' || child === 'file';
  }
  if (parent === 'box' || parent === 'file') {
    return child === 'item';
  }
  return false;
}

function getAddChildLevelOptions(level: HierarchyLevel): HierarchyLevel[] {
  if (level === 'series' || level === 'subseries') {
    return ['subseries', 'box', 'file'];
  }
  if (level === 'box' || level === 'file') {
    return ['item'];
  }
  return [];
}
