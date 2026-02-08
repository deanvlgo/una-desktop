import { type CSSProperties, type DragEvent, useMemo, useState } from 'react';

import {
  collectAncestorIds,
  isExpandedByPolicy,
  type FocusState,
  type HierarchyLevel,
  type HierarchyNode,
} from '../lib/series';

type PresenceUser = { id: string; name: string; color: string };

type FindingAidHierarchyProps = {
  root: HierarchyNode;
  focusState: FocusState;
  onFocus: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onMove: (draggedId: string, targetId: string, placement: 'before' | 'after') => void;
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
  file: 'File',
  item: 'Item',
};

const LEVEL_COLORS: Record<HierarchyLevel, string> = {
  series: '#ff5757',
  subseries: '#ff5757',
  file: '#3b82f6',
  item: '#6b7280',
};

export function FindingAidHierarchy({
  root,
  focusState,
  onFocus,
  onToggleExpand,
  onMove,
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

  const outline = useMemo(
    () => flattenVisibleHierarchy(root, focusState, focusedAncestors),
    [root, focusState, focusedAncestors],
  );

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
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dropEnd, setDropEnd] = useState(false);
  const [addMenuOpenId, setAddMenuOpenId] = useState<string | null>(null);

  const canDrop = (sourceId: string, targetId: string, placement: 'before' | 'after'): boolean => {
    if (sourceId === targetId) {
      return false;
    }

    const source = outlineById.get(sourceId);
    const target = outlineById.get(targetId);
    if (!source || !target) {
      return false;
    }

    if (source.depth === 0) {
      return false;
    }

    if (source.parentId !== target.parentId || source.level !== target.level) {
      return false;
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
    if (!source || source.depth === 0) {
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

  const resolvePlacement = (event: DragEvent<HTMLDivElement>): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  return (
    <div className="finding-hierarchy" aria-label="Guided processing hierarchy">
      <div className="finding-hierarchy__levels">
        {(['series', 'subseries', 'file', 'item'] as const).map((level) => (
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
            const isSelected = entry.isFocused;
            const isDropTarget = dropTarget?.id === entry.id;
            const isDragging = draggedId === entry.id;
            const dropBefore = isDropTarget && dropTarget?.placement === 'before';
            const dropAfter = isDropTarget && dropTarget?.placement === 'after';
            const presence = presenceByNodeId[entry.id] ?? [];
            const isRenameable = entry.level !== 'item' && typeof onRename === 'function';
            const siblingMeta = siblingMetaById.get(entry.id) ?? { prevId: null, nextId: null };
            const canIndent = computeCanIndent(entry, outlineById, siblingMetaById);
            const canOutdent = computeCanOutdent(entry, outlineById);
            const addChildOptions = getAddChildLevelOptions(entry.level);

            return (
              <div key={entry.id} className="finding-hierarchy__entry-wrap">
                {dropBefore ? <div className="finding-hierarchy__drop-line" aria-hidden /> : null}

                <div
                  className={`finding-hierarchy__outline-item ${isSelected ? 'is-selected' : ''} ${isDropTarget ? 'finding-hierarchy__drop-target' : ''} ${isDragging ? 'is-dragging' : ''}`}
                  style={{ marginLeft: entry.depth * 12 }}
                  role="treeitem"
                  aria-expanded={entry.hasChildren ? entry.expanded : undefined}
                  onMouseDown={() => {
                    onFocus(entry.id);
                    setAddMenuOpenId(null);
                  }}
                  onDragOver={(event) => {
                    if (!draggedId) {
                      return;
                    }

                    const placement = resolvePlacement(event);
                    if (!canDrop(draggedId, entry.id, placement)) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropEnd(false);
                    if (dropTarget?.id !== entry.id || dropTarget.placement !== placement) {
                      setDropTarget({ id: entry.id, placement });
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggedId) {
                      return;
                    }

                    const placement = resolvePlacement(event);
                    if (canDrop(draggedId, entry.id, placement)) {
                      onMove(draggedId, entry.id, placement);
                    }

                    setDraggedId(null);
                    setDropTarget(null);
                    setDropEnd(false);
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
                      if (entry.hasChildren) {
                        onToggleExpand(entry.id);
                      }
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
                      entry.depth === 0
                        ? 'finding-hierarchy__drag finding-hierarchy__drag--disabled'
                        : 'finding-hierarchy__drag'
                    }
                    draggable={entry.depth > 0}
                    onDragStart={(event) => {
                      if (entry.depth === 0) {
                        event.preventDefault();
                        return;
                      }

                      setDraggedId(entry.id);
                      setDropTarget(null);
                      setDropEnd(false);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', entry.id);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDropTarget(null);
                      setDropEnd(false);
                    }}
                    onDragOver={(event) => event.preventDefault()}
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
                          onChange={(event) => onRename(entry.id, event.target.value)}
                        />
                      ) : (
                        <span className="finding-hierarchy__pill-name" title={entry.title}>
                          {entry.title}
                        </span>
                      )}
                    </div>

                    <div className="finding-hierarchy__pill-actions">
                      {presence.length > 0 ? (
                        <span className="finding-hierarchy__presence" aria-label={`${presence.length} collaborators focused here`}>
                          {presence.map((person) => (
                            <span
                              key={person.id}
                              className="finding-hierarchy__presence-chip"
                              style={{ backgroundColor: person.color }}
                              title={`${person.name} focused`}
                            >
                              {person.name.slice(0, 1).toUpperCase()}
                            </span>
                          ))}
                        </span>
                      ) : null}

                    </div>
                  </div>

                  {isSelected ? (
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
                            }}
                          >
                            Indent
                          </button>
                        </>
                      ) : null}
                      {entry.hasChildren ? (
                        <button
                          type="button"
                          className="finding-hierarchy__action"
                          onClick={() => {
                            onToggleExpand(entry.id);
                            setAddMenuOpenId(null);
                          }}
                        >
                          {entry.expanded ? 'Collapse' : 'Expand'}
                        </button>
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
            onDragOver={(event) => {
              if (!draggedId) {
                return;
              }

              if (!moveToEndTarget(draggedId)) {
                return;
              }

              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropTarget(null);
              setDropEnd(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!draggedId) {
                return;
              }

              const moveTarget = moveToEndTarget(draggedId);
              if (moveTarget) {
                onMove(draggedId, moveTarget.targetId, moveTarget.placement);
              }

              setDraggedId(null);
              setDropTarget(null);
              setDropEnd(false);
            }}
            onDragLeave={() => {
              if (dropEnd) {
                setDropEnd(false);
              }
            }}
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
  if (entry.depth === 0) {
    return false;
  }

  const siblingMeta = siblingMetaById.get(entry.id);
  if (!siblingMeta?.prevId) {
    return false;
  }

  const previous = outlineById.get(siblingMeta.prevId);
  if (!previous) {
    return false;
  }

  return canContainHierarchyLevel(previous.level, entry.level);
}

function computeCanOutdent(entry: OutlineEntry, outlineById: Map<string, OutlineEntry>): boolean {
  if (entry.depth <= 1 || !entry.parentId) {
    return false;
  }

  const parent = outlineById.get(entry.parentId);
  if (!parent || !parent.parentId) {
    return false;
  }

  const grandParent = outlineById.get(parent.parentId);
  if (!grandParent) {
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
