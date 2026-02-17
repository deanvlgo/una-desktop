import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';

export type HierarchyWidgetLevel = 'series' | 'subseries' | 'box' | 'file' | 'item';

export type HierarchyWidgetMovePlacement = 'before' | 'after';

export type HierarchyWidgetRowKind = 'node' | 'seriesRef';

export type HierarchyWidgetPresenceUser = {
  id: string;
  name: string;
  color: string;
};

export type HierarchyWidgetAddChildOption = {
  level: string;
  label: string;
};

export type HierarchyWidgetRow = {
  id: string;
  parentId: string | null;
  level: HierarchyWidgetLevel;
  depth: number;
  title: string;
  hasChildren: boolean;
  expanded: boolean;
  pathLabel: string;
  kind: HierarchyWidgetRowKind;
  isSelected?: boolean;
  isActiveSeries?: boolean;
  seriesDocName?: string;
  seriesPresenceCount?: number;
  presence?: HierarchyWidgetPresenceUser[];
  canDrag?: boolean;
  canRename?: boolean;
  canIndent?: boolean;
  canOutdent?: boolean;
  canDelete?: boolean;
  moveUpTargetId?: string | null;
  moveDownTargetId?: string | null;
  addChildOptions?: HierarchyWidgetAddChildOption[];
};

export type HierarchyTreeWidgetProps = {
  rows: HierarchyWidgetRow[];
  title?: string;
  subtitle?: string;
  levelLabels?: Partial<Record<HierarchyWidgetLevel, string>>;
  levelColors?: Partial<Record<HierarchyWidgetLevel, string>>;
  className?: string;
  onFocusNode?: (id: string) => void;
  onSelectSeries?: (docName: string) => void;
  onToggleExpand?: (id: string) => void;
  onMove?: (sourceId: string, targetId: string, placement: HierarchyWidgetMovePlacement) => void;
  canDrop?: (sourceId: string, targetId: string, placement: HierarchyWidgetMovePlacement) => boolean;
  canDropToEnd?: (sourceId: string) => { targetId: string; placement: HierarchyWidgetMovePlacement } | null;
  onRename?: (id: string, title: string) => void;
  onIndent?: (id: string) => void;
  onOutdent?: (id: string) => void;
  onAddChild?: (parentId: string, level: string) => void;
  onDelete?: (id: string) => void;
  getUserInitials?: (name: string) => string;
};

const DEFAULT_LEVEL_LABELS: Record<HierarchyWidgetLevel, string> = {
  series: 'Series',
  subseries: 'Subseries',
  box: 'Box',
  file: 'File',
  item: 'Item',
};

const DEFAULT_LEVEL_COLORS: Record<HierarchyWidgetLevel, string> = {
  series: '#ff5757',
  subseries: '#ff5757',
  box: '#8b5cf6',
  file: '#3b82f6',
  item: '#6b7280',
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '?';
  }

  const [first, second] = trimmed.split(/\s+/);
  const head = first?.[0] ?? '?';
  const tail = second?.[0] ?? '';
  return `${head}${tail}`.toUpperCase();
}

export function HierarchyTreeWidget({
  rows,
  title = 'Hierarchy',
  subtitle = 'Drag rows to reorder siblings',
  levelLabels,
  levelColors,
  className,
  onFocusNode,
  onSelectSeries,
  onToggleExpand,
  onMove,
  canDrop,
  canDropToEnd,
  onRename,
  onIndent,
  onOutdent,
  onAddChild,
  onDelete,
  getUserInitials,
}: HierarchyTreeWidgetProps) {
  const resolvedLevelLabels = useMemo(
    () => ({ ...DEFAULT_LEVEL_LABELS, ...(levelLabels ?? {}) }),
    [levelLabels],
  );
  const resolvedLevelColors = useMemo(
    () => ({ ...DEFAULT_LEVEL_COLORS, ...(levelColors ?? {}) }),
    [levelColors],
  );

  const rowById = useMemo(() => {
    const map = new Map<string, HierarchyWidgetRow>();
    for (const row of rows) {
      map.set(row.id, row);
    }
    return map;
  }, [rows]);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const pointerDraggedIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: HierarchyWidgetMovePlacement } | null>(null);
  const [dropEnd, setDropEnd] = useState(false);
  const [addMenuOpenId, setAddMenuOpenId] = useState<string | null>(null);
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);

  const rootClass = className ? `finding-hierarchy ${className}` : 'finding-hierarchy';

  const beginPointerDrag = (
    event: ReactPointerEvent,
    rowId: string,
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

    pointerDraggedIdRef.current = rowId;
    setDraggedId(rowId);
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

  const resolvePlacementFromClientY = (clientY: number, rect: DOMRect): HierarchyWidgetMovePlacement =>
    clientY < rect.top + rect.height / 2 ? 'before' : 'after';

  useEffect(() => {
    if (!draggedId) {
      return;
    }

    const resolveDropFromPointer = (clientX: number, clientY: number) => {
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
      if (canDrop && !canDrop(sourceId, targetId, placement)) {
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
      if (onEndZone && canDropToEnd?.(sourceId)) {
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
      if (maybeDrop && onMove) {
        onMove(sourceId, maybeDrop.id, maybeDrop.placement);
        endPointerDrag();
        return;
      }

      if (dropEnd && onMove) {
        const moveTarget = canDropToEnd?.(sourceId) ?? null;
        if (moveTarget) {
          onMove(sourceId, moveTarget.targetId, moveTarget.placement);
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
  }, [canDrop, canDropToEnd, draggedId, dropEnd, dropTarget, onMove]);

  return (
    <div className={rootClass} aria-label="Guided processing hierarchy">
      <div className="finding-hierarchy__levels">
        {(['series', 'subseries', 'box', 'file', 'item'] as const).map((level) => (
          <span key={level} className="finding-hierarchy__level-chip">
            <span className="finding-hierarchy__level-dot" style={{ backgroundColor: resolvedLevelColors[level] }} />
            {resolvedLevelLabels[level]}
          </span>
        ))}
      </div>

      <div className="finding-hierarchy__outline">
        <div className="finding-hierarchy__outline-header">
          <div className="finding-hierarchy__outline-title">{title}</div>
          <div className="finding-hierarchy__outline-sub">{subtitle}</div>
        </div>

        <div className="finding-hierarchy__outline-list" role="tree">
          {rows.map((row) => {
            const isSeriesRef = row.kind === 'seriesRef';
            const isNodeRow = row.kind === 'node';
            const isSeriesRow = row.level === 'series' && row.depth === 0;
            const canDragRow = Boolean(row.canDrag);
            const isDropTarget = dropTarget?.id === row.id;
            const isDragging = draggedId === row.id;
            const dropBefore = isDropTarget && dropTarget?.placement === 'before';
            const dropAfter = isDropTarget && dropTarget?.placement === 'after';
            const presence = row.presence ?? [];
            const initialsFor = getUserInitials ?? initials;
            const addChildOptions = row.addChildOptions ?? [];
            const canRename = Boolean(row.canRename && typeof onRename === 'function');
            const canDelete = row.canDelete ?? row.depth > 0;

            return (
              <div key={row.id} className="finding-hierarchy__entry-wrap">
                {dropBefore ? <div className="finding-hierarchy__drop-line" aria-hidden /> : null}

                <div
                  className={`finding-hierarchy__outline-item ${row.isSelected ? 'is-selected' : ''} ${row.isActiveSeries ? 'is-series-active' : ''} ${isDropTarget ? 'finding-hierarchy__drop-target' : ''} ${isDragging ? 'is-dragging' : ''}`}
                  style={{ marginLeft: row.depth * 12 }}
                  data-hierarchy-row-id={row.id}
                  role="treeitem"
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest('input, textarea, select, button, a')) {
                      return;
                    }

                    if (isSeriesRef) {
                      if (row.seriesDocName) {
                        onSelectSeries?.(row.seriesDocName);
                      }
                      setAddMenuOpenId(null);
                      setActionMenuOpenId(null);
                      return;
                    }

                    onFocusNode?.(row.id);
                    setAddMenuOpenId(null);
                    setActionMenuOpenId(null);
                    beginPointerDrag(event, row.id, row.depth, false);
                  }}
                >
                  <button
                    type="button"
                    className={
                      row.hasChildren
                        ? 'finding-hierarchy__expand'
                        : 'finding-hierarchy__expand finding-hierarchy__expand--hidden'
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!row.hasChildren) {
                        return;
                      }

                      if (isSeriesRef) {
                        if (row.seriesDocName) {
                          onSelectSeries?.(row.seriesDocName);
                        }
                        return;
                      }

                      onToggleExpand?.(row.id);
                    }}
                    aria-label={row.expanded ? 'Collapse node' : 'Expand node'}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ transform: row.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
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
                        onFocusNode?.(row.id);
                      }
                      setAddMenuOpenId(null);
                      setActionMenuOpenId(null);
                      beginPointerDrag(event, row.id, row.depth, isSeriesRow);
                    }}
                    aria-label="Drag to reorder sibling"
                    title="Drag to reorder sibling"
                  >
                    <span className="finding-hierarchy__grip" />
                  </div>

                  <div
                    className="finding-hierarchy__pill"
                    style={{ '--level-color': resolvedLevelColors[row.level] } as CSSProperties}
                  >
                    <div className="finding-hierarchy__pill-main">
                      <div className="finding-hierarchy__pill-left">
                        <span className="finding-hierarchy__pill-level-name">{resolvedLevelLabels[row.level]}</span>
                        {row.pathLabel.length > 0 ? <span className="finding-hierarchy__pill-number">{row.pathLabel}</span> : null}
                      </div>
                      <div className="finding-hierarchy__pill-divider" />

                      {canRename ? (
                        <input
                          value={row.title}
                          onFocus={() => onFocusNode?.(row.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onRename?.(row.id, event.target.value)}
                        />
                      ) : (
                        <span className="finding-hierarchy__pill-name" title={row.title}>
                          {row.title}
                        </span>
                      )}
                    </div>

                    <div className="finding-hierarchy__pill-actions">
                      {row.seriesPresenceCount != null ? (
                        <span className="finding-hierarchy__series-count">
                          {row.seriesPresenceCount} active {row.seriesPresenceCount === 1 ? 'user' : 'users'}
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
                              {initialsFor(person.name)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {isNodeRow ? (
                        <button
                          type="button"
                          className="finding-hierarchy__menu-trigger"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onFocusNode?.(row.id);
                            setAddMenuOpenId(null);
                            setActionMenuOpenId((current) => (current === row.id ? null : row.id));
                          }}
                          aria-label="Open row actions"
                          aria-expanded={actionMenuOpenId === row.id}
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

                  {isNodeRow && actionMenuOpenId === row.id ? (
                    <div
                      className="finding-hierarchy__row-popover"
                      role="toolbar"
                      aria-label="Row actions"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.depth > 0 ? (
                        <>
                          <button
                            type="button"
                            className="finding-hierarchy__action"
                            disabled={!row.moveUpTargetId}
                            onClick={() => {
                              if (row.moveUpTargetId && onMove) {
                                onMove(row.id, row.moveUpTargetId, 'before');
                                onFocusNode?.(row.id);
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
                            disabled={!row.moveDownTargetId}
                            onClick={() => {
                              if (row.moveDownTargetId && onMove) {
                                onMove(row.id, row.moveDownTargetId, 'after');
                                onFocusNode?.(row.id);
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
                            disabled={!row.canOutdent}
                            onClick={() => {
                              onOutdent?.(row.id);
                              onFocusNode?.(row.id);
                              setAddMenuOpenId(null);
                              setActionMenuOpenId(null);
                            }}
                          >
                            Outdent
                          </button>
                          <button
                            type="button"
                            className="finding-hierarchy__action"
                            disabled={!row.canIndent}
                            onClick={() => {
                              onIndent?.(row.id);
                              onFocusNode?.(row.id);
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
                          aria-expanded={addMenuOpenId === row.id}
                          disabled={addChildOptions.length === 0}
                          onClick={() => {
                            if (addChildOptions.length === 0) {
                              return;
                            }
                            setAddMenuOpenId((current) => (current === row.id ? null : row.id));
                          }}
                        >
                          +
                        </button>

                        {addMenuOpenId === row.id ? (
                          <div className="finding-hierarchy__add-menu" role="menu">
                            {addChildOptions.map((option) => (
                              <button
                                key={`${row.id}-${option.level}`}
                                type="button"
                                role="menuitem"
                                className="finding-hierarchy__add-menu-item"
                                onClick={() => {
                                  onAddChild?.(row.id, option.level);
                                  setAddMenuOpenId(null);
                                  setActionMenuOpenId(null);
                                }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className="finding-hierarchy__action finding-hierarchy__delete-btn"
                        disabled={!canDelete}
                        onClick={() => {
                          if (!canDelete) {
                            return;
                          }
                          onDelete?.(row.id);
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

          <div className={`finding-hierarchy__outline-drop-end ${dropEnd ? 'is-drop-target' : ''}`} aria-hidden>
            {dropEnd ? <div className="finding-hierarchy__drop-slot" aria-hidden /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
