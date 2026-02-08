import { useMemo, type CSSProperties } from 'react';

import {
  collectAncestorIds,
  compactSummary,
  isExpandedByPolicy,
  type FocusState,
  type HierarchyLevel,
  type HierarchyNode,
} from '../lib/series';

type HierarchyRailProps = {
  root: HierarchyNode;
  focusState: FocusState;
  onFocus: (id: string) => void;
  onToggleExpand: (id: string) => void;
  presenceByNodeId?: Record<string, Array<{ id: string; name: string; color: string }>>;
};

type LevelConfig = {
  label: string;
  color: string;
};

const LEVEL_CONFIG: Record<HierarchyLevel, LevelConfig> = {
  series: { label: 'Series', color: '#ff5757' },
  subseries: { label: 'Subseries', color: '#8b5cf6' },
  file: { label: 'File', color: '#3b82f6' },
  item: { label: 'Item', color: '#6b7280' },
};

export function HierarchyRail({
  root,
  focusState,
  onFocus,
  onToggleExpand,
  presenceByNodeId = {},
}: HierarchyRailProps) {
  const focusedAncestors = useMemo(
    () => collectAncestorIds(root, focusState.focusedId),
    [root, focusState.focusedId],
  );

  return (
    <div className="hierarchy-editor" aria-label="Archival hierarchy rail">
      <div className="hierarchy-editor__hint">
        PRD-aligned hierarchy navigation for Document and CMS/Focus modes.
      </div>
      <div className="hierarchy-editor__tree">
        <ul className="hierarchy-list">
          <HierarchyRow
            node={root}
            depth={0}
            lineage={[]}
            focusState={focusState}
            focusedAncestors={focusedAncestors}
            onFocus={onFocus}
            onToggleExpand={onToggleExpand}
            presenceByNodeId={presenceByNodeId}
          />
        </ul>
      </div>
    </div>
  );
}

type HierarchyRowProps = {
  node: HierarchyNode;
  depth: number;
  lineage: HierarchyLevel[];
  focusState: FocusState;
  focusedAncestors: Set<string>;
  onFocus: (id: string) => void;
  onToggleExpand: (id: string) => void;
  presenceByNodeId: Record<string, Array<{ id: string; name: string; color: string }>>;
};

function HierarchyRow({
  node,
  depth,
  lineage,
  focusState,
  focusedAncestors,
  onFocus,
  onToggleExpand,
  presenceByNodeId,
}: HierarchyRowProps) {
  const hasChildren = node.children.length > 0;
  const expanded = isExpandedByPolicy(node.id, focusState, focusedAncestors);
  const focused = focusState.focusedId === node.id;
  const config = LEVEL_CONFIG[node.level];
  const summary = focusState.mode === 'focus' ? compactSummary(node) : node.title;
  const nextLineage = [...lineage, node.level];
  const presence = presenceByNodeId[node.id] ?? [];

  return (
    <li className="hierarchy-list__item">
      <div
        className={`tree-node ${focused ? 'tree-node--focused' : ''}`}
        style={{ '--row-color': config.color } as CSSProperties}
      >
        <div className="tree-node__lines" style={{ width: depth * 14 }}>
          {lineage.map((level, index) => (
            <span
              key={`${node.id}-line-${level}-${index}`}
              className="tree-node__line-v tree-node__line-v--through"
              style={{ left: index * 14 + 7, backgroundColor: LEVEL_CONFIG[level].color }}
            />
          ))}
        </div>

        <div className="tree-node__content">
          <button
            type="button"
            className={`tree-node__arrow ${hasChildren ? '' : 'tree-node__arrow--hidden'}`}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) {
                onToggleExpand(node.id);
              }
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            >
              <path d="M8 5l8 7-8 7V5z" />
            </svg>
          </button>

          <span className="tree-node__badge" style={{ backgroundColor: config.color }}>
            {config.label}
          </span>

          <button
            type="button"
            className="tree-node__name"
            onClick={() => onFocus(node.id)}
            title={node.title}
          >
            {summary}
          </button>

          {presence.length > 0 ? (
            <span className="tree-node__presence" aria-label={`${presence.length} collaborators focused here`}>
              {presence.map((user) => (
                <span
                  key={user.id}
                  className="tree-node__presence-chip"
                  style={{ backgroundColor: user.color }}
                  title={`${user.name} focused`}
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      {hasChildren && expanded ? (
        <ul className="hierarchy-list">
          {node.children.map((child) => (
            <HierarchyRow
              key={child.id}
              node={child}
              depth={depth + 1}
              lineage={nextLineage}
              focusState={focusState}
              focusedAncestors={focusedAncestors}
              onFocus={onFocus}
              onToggleExpand={onToggleExpand}
              presenceByNodeId={presenceByNodeId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
