import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  AwarenessStore,
  InMemoryAgentActionLog,
  acceptMoveSubtreeCrossSeries,
  acceptSuggestionBlock,
  acceptSuggestionDelete,
  acceptSuggestionGroup,
  acceptSuggestionInsert,
  appendSeriesOpSuggestion,
  createPairedMoveProposals,
  createSuggestionBlockNode,
  evaluateMoveProposalStaleness,
  exportCollection,
  listBlockSuggestions,
  listInlineSuggestionIds,
  rejectMoveSubtreeCrossSeries,
  rejectSuggestionBlock,
  rejectSuggestionDelete,
  rejectSuggestionGroup,
  rejectSuggestionInsert,
  seriesDocName,
} from '../../../packages/core/src';
import type {
  AgentActionLogRecord,
  CollectionManifestDoc,
  PMNode,
  SeriesDoc,
  SuggestionBlockNode,
} from '../../../src/contracts/types';
import inlineDeleteParagraphFixture from '../../../src/fixtures/suggestion.inline-delete.paragraph.json';
import inlineInsertParagraphFixture from '../../../src/fixtures/suggestion.inline-insert.paragraph.json';
import manifestFixture from '../../../src/fixtures/manifest.doc.json';
import suggestionCreateItemFixture from '../../../src/fixtures/suggestion.block.create-item.json';
import suggestionMoveFixture from '../../../src/fixtures/suggestion.block.move-cross-series.source.json';
import suggestionReorderFixture from '../../../src/fixtures/suggestion.block.reorder-sibling.json';
import { FindingAidEditor, buildFindingAidDocJson, type HierarchyHeading } from './components/FindingAidEditor';
import { FindingAidHierarchy } from './components/FindingAidHierarchy';
import {
  addHierarchyChildNode,
  buildHierarchyTree,
  collectHierarchySubtreeIds,
  createInitialFocusState,
  deleteHierarchyNode,
  getSeriesBodyNodes,
  getSelectOptions,
  indentHierarchyNode,
  moveSiblingHierarchyNode,
  nodeExists,
  outdentHierarchyNode,
  readFocusedNode,
  setSeriesBodyNodes,
  syncSeriesBodyWithHierarchy,
  transferHierarchySectionsBetweenDocs,
  updateItemFieldValue,
  updateNodeMetadata,
  type FocusState,
  type HierarchyLevel,
  type HierarchyNode,
  type ItemFieldModel,
} from './lib/series';

type ManifestSeriesRef = {
  seriesId: string;
  title: string;
  order: number;
  docName: string;
};

type WorkspaceState = {
  manifestDoc: CollectionManifestDoc;
  seriesDocs: Record<string, SeriesDoc>;
  activeSeriesDocName: string;
};

type FocusStateMap = Record<string, FocusState>;
type RailPanelMode = 'collections' | 'hierarchy';
type CmsFieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  section: 'Core Metadata' | 'Arrangement & Scope' | 'Access & Rights' | 'Digital';
  multiline?: boolean;
};

type PresenceMap = Record<string, Array<{ id: string; name: string; color: string }>>;

const COLLECTION_ID = 'col-001';
const SERIES_A_DOC_NAME = seriesDocName(COLLECTION_ID, 'series-a');
const SERIES_B_DOC_NAME = seriesDocName(COLLECTION_ID, 'series-b');
const SERIES_C_DOC_NAME = seriesDocName(COLLECTION_ID, 'series-c');
const SERIES_D_DOC_NAME = seriesDocName(COLLECTION_ID, 'series-d');

const CMS_LEVEL_COLORS: Record<HierarchyLevel, string> = {
  series: '#ff5757',
  subseries: '#ff5757',
  file: '#3b82f6',
  item: '#6b7280',
};

const CMS_FIELDS: CmsFieldSpec[] = [
  { key: 'dates', label: 'Dates', placeholder: 'e.g. 1930-1940', section: 'Core Metadata' },
  { key: 'refCode', label: 'Reference Code', placeholder: 'MS-001.2', section: 'Core Metadata' },
  { key: 'extent', label: 'Extent', placeholder: '2 linear feet', section: 'Core Metadata' },
  { key: 'language', label: 'Language', placeholder: 'English', section: 'Core Metadata' },
  { key: 'arrangement', label: 'Arrangement', placeholder: 'Chronological', section: 'Arrangement & Scope' },
  {
    key: 'scopeContent',
    label: 'Scope & Content',
    placeholder: 'Summary of records covered by this level.',
    section: 'Arrangement & Scope',
    multiline: true,
  },
  {
    key: 'accessRestrictions',
    label: 'Access Restrictions',
    placeholder: 'Open with restrictions for personnel files.',
    section: 'Access & Rights',
    multiline: true,
  },
  {
    key: 'processingStatus',
    label: 'Processing Status',
    placeholder: 'processed | in-progress | minimally-processed',
    section: 'Access & Rights',
  },
  {
    key: 'digitalObjectUrl',
    label: 'Digital Object URL',
    placeholder: 'https://example.org/object',
    section: 'Digital',
  },
];

const LOCAL_USER = { id: 'user-local', name: 'You', color: '#ff5757' };
const PEER_USER = { id: 'user-peer', name: 'Peer', color: '#3b82f6' };

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createInitialWorkspace());
  const [focusStateByDoc, setFocusStateByDoc] = useState<FocusStateMap>({});
  const [railPanelMode, setRailPanelMode] = useState<RailPanelMode>('collections');
  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return new URLSearchParams(window.location.search).get('debug') === '1';
  });
  const [exportPreview, setExportPreview] = useState('');
  const [logVersion, setLogVersion] = useState(0);
  const [presenceByNodeId, setPresenceByNodeId] = useState<PresenceMap>({});
  const [collectionPresence, setCollectionPresence] = useState<Record<string, number>>({});

  const [actionLogStore] = useState(() => new InMemoryAgentActionLog());
  const [awarenessStore] = useState(() => new AwarenessStore());

  const seriesRefs = useMemo(() => readManifestSeriesRefs(workspace.manifestDoc), [workspace.manifestDoc]);
  const activeSeriesRef = useMemo(
    () => seriesRefs.find((series) => series.docName === workspace.activeSeriesDocName) ?? null,
    [seriesRefs, workspace.activeSeriesDocName],
  );

  const activeSeriesDoc = workspace.seriesDocs[workspace.activeSeriesDocName] ?? null;

  const activeHierarchy = useMemo<HierarchyNode | null>(() => {
    if (!activeSeriesDoc) {
      return null;
    }
    return buildHierarchyTree(activeSeriesDoc);
  }, [activeSeriesDoc]);

  useEffect(() => {
    if (!activeHierarchy) {
      return;
    }

    setFocusStateByDoc((previous) => {
      if (previous[workspace.activeSeriesDocName]) {
        return previous;
      }

      return {
        ...previous,
        [workspace.activeSeriesDocName]: createInitialFocusState(activeHierarchy.id),
      };
    });
  }, [activeHierarchy, workspace.activeSeriesDocName]);

  const currentFocusState =
    activeHierarchy && focusStateByDoc[workspace.activeSeriesDocName]
      ? focusStateByDoc[workspace.activeSeriesDocName]
      : activeHierarchy
        ? createInitialFocusState(activeHierarchy.id)
        : null;

  const updateCurrentFocusState = useCallback(
    (updater: (state: FocusState) => FocusState) => {
      if (!activeHierarchy) {
        return;
      }

      setFocusStateByDoc((previous) => {
        const current = previous[workspace.activeSeriesDocName] ?? createInitialFocusState(activeHierarchy.id);
        return {
          ...previous,
          [workspace.activeSeriesDocName]: updater(current),
        };
      });
    },
    [activeHierarchy, workspace.activeSeriesDocName],
  );

  useEffect(() => {
    if (!activeHierarchy || !currentFocusState) {
      return;
    }

    if (nodeExists(activeHierarchy, currentFocusState.focusedId)) {
      return;
    }

    updateCurrentFocusState((state) => ({
      ...state,
      focusedId: activeHierarchy.id,
      expandedIds: new Set([activeHierarchy.id]),
    }));
  }, [activeHierarchy, currentFocusState, updateCurrentFocusState]);

  useEffect(() => {
    if (!activeHierarchy || !currentFocusState) {
      return;
    }

    const peerFocus = activeHierarchy.children[0]?.id ?? activeHierarchy.id;
    awarenessStore.set(workspace.activeSeriesDocName, {
      user: LOCAL_USER,
      focusId: currentFocusState.focusedId,
      updatedAt: Date.now(),
    });

    awarenessStore.set(workspace.activeSeriesDocName, {
      user: PEER_USER,
      focusId: peerFocus,
      updatedAt: Date.now(),
    });

    setPresenceByNodeId(awarenessStore.focusChips(workspace.activeSeriesDocName));
    setCollectionPresence(awarenessStore.listCollectionPresence('series:'));
  }, [awarenessStore, workspace.activeSeriesDocName, activeHierarchy, currentFocusState]);

  useEffect(() => {
    const handleToggleDebug = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDebugMode((value) => !value);
      }
    };

    window.addEventListener('keydown', handleToggleDebug);
    return () => window.removeEventListener('keydown', handleToggleDebug);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (debugMode) {
      url.searchParams.set('debug', '1');
    } else {
      url.searchParams.delete('debug');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [debugMode]);

  const focusedNode = useMemo(() => {
    if (!activeSeriesDoc || !currentFocusState) {
      return null;
    }

    return readFocusedNode(activeSeriesDoc, currentFocusState.focusedId);
  }, [activeSeriesDoc, currentFocusState]);

  const hierarchyHeadings = useMemo<HierarchyHeading[]>(() => {
    if (!activeHierarchy) {
      return [];
    }
    return flattenHierarchyHeadingsForDocument(activeHierarchy);
  }, [activeHierarchy]);

  const seriesBodyNodes = useMemo(() => {
    if (!activeSeriesDoc) {
      return [] as PMNode[];
    }
    return getSeriesBodyNodes(activeSeriesDoc);
  }, [activeSeriesDoc]);

  const findingAidDocJson = useMemo(
    () => buildFindingAidDocJson(seriesBodyNodes, hierarchyHeadings),
    [hierarchyHeadings, seriesBodyNodes],
  );

  const persistedSeriesBodyJson = useMemo(
    () => ({
      type: 'doc',
      content: seriesBodyNodes,
    }),
    [seriesBodyNodes],
  );

  const updateActiveSeriesDoc = useCallback((updater: (doc: SeriesDoc) => SeriesDoc) => {
    setWorkspace((previous) => {
      const current = previous.seriesDocs[previous.activeSeriesDocName];
      if (!current) {
        return previous;
      }

      const nextDoc = updater(current);
      return {
        ...previous,
        seriesDocs: {
          ...previous.seriesDocs,
          [previous.activeSeriesDocName]: nextDoc,
        },
      };
    });
  }, []);

  const setActiveSeriesDocName = useCallback((docName: string) => {
    setWorkspace((previous) => ({
      ...previous,
      activeSeriesDocName: docName,
    }));
  }, []);

  const openSeriesFromBrowser = useCallback(
    (docName: string) => {
      setActiveSeriesDocName(docName);
      setRailPanelMode('hierarchy');
    },
    [setActiveSeriesDocName],
  );

  const focusHierarchyNode = useCallback(
    (id: string) => {
      updateCurrentFocusState((state) => ({
        ...state,
        focusedId: id,
        mode: 'focus',
        expandedIds: new Set(state.expandedIds),
      }));
    },
    [updateCurrentFocusState],
  );

  const applyHierarchyMetadataPatch = useCallback(
    (nodeId: string, patch: Record<string, string | undefined>) => {
      updateActiveSeriesDoc((doc) => {
        const next = updateNodeMetadata(doc, nodeId, patch);
        if (patch.title !== undefined) {
          return syncSeriesBodyWithHierarchy(next);
        }
        return next;
      });
    },
    [updateActiveSeriesDoc],
  );

  const blockSuggestions = useMemo(() => {
    if (!activeSeriesDoc) {
      return [];
    }

    return listBlockSuggestions(activeSeriesDoc).map((entry) => {
      if (entry.kind !== 'MOVE_SUBTREE_CROSS_SERIES') {
        return entry;
      }

      const staleness = evaluateMoveProposalStaleness(workspace.seriesDocs, entry.sid);
      return {
        ...entry,
        stale: staleness.stale,
        staleReason: staleness.reason,
      };
    });
  }, [activeSeriesDoc, workspace.seriesDocs]);

  const inlineSuggestions = useMemo(() => {
    if (!activeSeriesDoc) {
      return { insertIds: [] as string[], deleteIds: [] as string[] };
    }

    return listInlineSuggestionIds(activeSeriesDoc);
  }, [activeSeriesDoc]);

  const suggestionsByGroup = useMemo(() => {
    const grouped = new Map<string, string[]>();

    for (const suggestion of blockSuggestions) {
      if (!suggestion.groupId) {
        continue;
      }
      const ids = grouped.get(suggestion.groupId) ?? [];
      ids.push(suggestion.sid);
      grouped.set(suggestion.groupId, ids);
    }

    return grouped;
  }, [blockSuggestions]);

  const logEntries = useMemo(() => actionLogStore.list().slice(-8).reverse(), [actionLogStore, logVersion]);

  const appendActionLog = useCallback(
    (record: AgentActionLogRecord) => {
      actionLogStore.append(record);
      setLogVersion((value) => value + 1);
    },
    [actionLogStore],
  );

  const applyBlockSuggestionDecision = useCallback(
    (sid: string, decision: 'accept' | 'reject') => {
      const activeDoc = workspace.seriesDocs[workspace.activeSeriesDocName];
      if (!activeDoc) {
        return;
      }

      const target = blockSuggestions.find((entry) => entry.sid === sid);
      if (!target) {
        return;
      }

      let nextSeriesDocs = workspace.seriesDocs;
      let status: 'applied' | 'noop' | 'stale' | 'failed' = 'noop';
      let reason: string | undefined;
      let docNames = [workspace.activeSeriesDocName];

      if (target.kind === 'MOVE_SUBTREE_CROSS_SERIES') {
        const payload = target.payload as {
          source?: { docName?: string };
          target?: { docName?: string };
          subtreeRootId?: string;
        };

        const sourceDocName = payload.source?.docName;
        const targetDocName = payload.target?.docName;
        const sourceDoc = sourceDocName ? workspace.seriesDocs[sourceDocName] : undefined;
        const targetDoc = targetDocName ? workspace.seriesDocs[targetDocName] : undefined;
        const movedHierarchyIds =
          decision === 'accept' && sourceDoc && payload.subtreeRootId
            ? collectHierarchySubtreeIds(sourceDoc, payload.subtreeRootId)
            : [];

        const outcome =
          decision === 'accept'
            ? acceptMoveSubtreeCrossSeries(workspace.seriesDocs, sid)
            : rejectMoveSubtreeCrossSeries(workspace.seriesDocs, sid);

        nextSeriesDocs = { ...outcome.docs };

        if (decision === 'accept' && outcome.status === 'applied' && sourceDocName && targetDocName) {
          const sourceAfter = nextSeriesDocs[sourceDocName];
          const targetAfter = nextSeriesDocs[targetDocName];
          if (sourceAfter && targetAfter && movedHierarchyIds.length > 0) {
            const transferred = transferHierarchySectionsBetweenDocs({
              sourceDoc: sourceAfter,
              targetDoc: targetAfter,
              hierarchyIds: movedHierarchyIds,
            });
            nextSeriesDocs[sourceDocName] = transferred.sourceDoc;
            nextSeriesDocs[targetDocName] = transferred.targetDoc;
          }
        }

        if (sourceDocName && nextSeriesDocs[sourceDocName]) {
          nextSeriesDocs[sourceDocName] = syncSeriesBodyWithHierarchy(nextSeriesDocs[sourceDocName]);
        }
        if (targetDocName && nextSeriesDocs[targetDocName]) {
          nextSeriesDocs[targetDocName] = syncSeriesBodyWithHierarchy(nextSeriesDocs[targetDocName]);
        }

        status = outcome.status;
        reason = outcome.reason;
        docNames = [payload.source?.docName, payload.target?.docName].filter(Boolean) as string[];
      } else {
        const outcome =
          decision === 'accept' ? acceptSuggestionBlock(activeDoc, sid) : rejectSuggestionBlock(activeDoc, sid);

        nextSeriesDocs = {
          ...workspace.seriesDocs,
          [workspace.activeSeriesDocName]: syncSeriesBodyWithHierarchy(outcome.doc),
        };
        status = outcome.status;
        reason = outcome.reason;
      }

      setWorkspace((previous) => ({
        ...previous,
        seriesDocs: nextSeriesDocs,
      }));

      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames,
        suggestionIds: [sid],
        groupId: target.groupId,
        promptSummary: `${decision.toUpperCase()} ${target.kind}`,
        result: status === 'applied' || status === 'noop' ? 'ok' : 'failed',
        errorMessage: reason,
      });
    },
    [appendActionLog, blockSuggestions, workspace],
  );

  const applyGroupDecision = useCallback(
    (groupId: string, decision: 'accept' | 'reject') => {
      const activeDoc = workspace.seriesDocs[workspace.activeSeriesDocName];
      if (!activeDoc) {
        return;
      }

      const groupedSuggestions = blockSuggestions.filter((entry) => entry.groupId === groupId);
      if (groupedSuggestions.length === 0) {
        return;
      }

      if (groupedSuggestions.some((entry) => entry.kind === 'MOVE_SUBTREE_CROSS_SERIES')) {
        for (const suggestion of groupedSuggestions) {
          applyBlockSuggestionDecision(suggestion.sid, decision);
        }
        return;
      }

      const outcome =
        decision === 'accept' ? acceptSuggestionGroup(activeDoc, groupId) : rejectSuggestionGroup(activeDoc, groupId);

      setWorkspace((previous) => ({
        ...previous,
        seriesDocs: {
          ...previous.seriesDocs,
          [previous.activeSeriesDocName]: syncSeriesBodyWithHierarchy(outcome.doc),
        },
      }));

      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: groupedSuggestions.map((entry) => entry.sid),
        groupId,
        promptSummary: `${decision.toUpperCase()} group ${groupId}`,
        result: outcome.failed.length === 0 && outcome.stale.length === 0 ? 'ok' : 'failed',
        errorMessage:
          outcome.failed.length > 0 || outcome.stale.length > 0
            ? `failed=${outcome.failed.length} stale=${outcome.stale.length}`
            : undefined,
      });
    },
    [applyBlockSuggestionDecision, appendActionLog, blockSuggestions, workspace],
  );

  const applyInlineSuggestionDecision = useCallback(
    (sid: string, kind: 'insert' | 'delete', decision: 'accept' | 'reject') => {
      updateActiveSeriesDoc((doc) => {
        if (kind === 'insert') {
          return (decision === 'accept' ? acceptSuggestionInsert(doc, sid) : rejectSuggestionInsert(doc, sid)).doc as SeriesDoc;
        }

        return (decision === 'accept' ? acceptSuggestionDelete(doc, sid) : rejectSuggestionDelete(doc, sid)).doc as SeriesDoc;
      });

      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [sid],
        promptSummary: `${decision.toUpperCase()} inline ${kind}`,
        result: 'ok',
      });
    },
    [appendActionLog, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyMove = useCallback(
    (draggedId: string, targetId: string, placement: 'before' | 'after') => {
      updateActiveSeriesDoc((doc) =>
        syncSeriesBodyWithHierarchy(moveSiblingHierarchyNode(doc, draggedId, targetId, placement)),
      );
      focusHierarchyNode(draggedId);

      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL REORDER ${draggedId} ${placement} ${targetId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyIndent = useCallback(
    (nodeId: string) => {
      updateActiveSeriesDoc((doc) => syncSeriesBodyWithHierarchy(indentHierarchyNode(doc, nodeId)));
      focusHierarchyNode(nodeId);
      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL INDENT ${nodeId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyOutdent = useCallback(
    (nodeId: string) => {
      updateActiveSeriesDoc((doc) => syncSeriesBodyWithHierarchy(outdentHierarchyNode(doc, nodeId)));
      focusHierarchyNode(nodeId);
      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL OUTDENT ${nodeId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyAddChild = useCallback(
    (parentId: string, level: HierarchyLevel) => {
      const insertedId = `${level}-${crypto.randomUUID()}`;
      updateActiveSeriesDoc((doc) =>
        syncSeriesBodyWithHierarchy(
          addHierarchyChildNode(doc, parentId, level, {
            id: insertedId,
          }),
        ),
      );
      focusHierarchyNode(insertedId);
      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL ADD ${level} under ${parentId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyDelete = useCallback(
    (nodeId: string) => {
      const fallbackFocusId = activeHierarchy ? findParentId(activeHierarchy, nodeId) ?? activeHierarchy.id : null;
      updateActiveSeriesDoc((doc) => syncSeriesBodyWithHierarchy(deleteHierarchyNode(doc, nodeId)));
      if (fallbackFocusId) {
        focusHierarchyNode(fallbackFocusId);
      }
      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL DELETE ${nodeId}`,
        result: 'ok',
      });
    },
    [activeHierarchy, appendActionLog, focusHierarchyNode, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const stageCrossSeriesMoveProposal = useCallback(() => {
    const sourceDoc = workspace.seriesDocs[SERIES_A_DOC_NAME];
    const targetDoc = workspace.seriesDocs[SERIES_B_DOC_NAME];
    if (!sourceDoc || !targetDoc) {
      return;
    }

    const sid = `debug-move-${Date.now()}`;
    const paired = createPairedMoveProposals({
      sourceDoc,
      targetDoc,
      sid,
      author: LOCAL_USER.id,
      createdAt: Date.now(),
      payload: {
        source: {
          seriesId: 'series-a',
          docName: SERIES_A_DOC_NAME,
        },
        target: {
          seriesId: 'series-b',
          docName: SERIES_B_DOC_NAME,
        },
        subtreeRootId: 'file-a2',
        targetParentId: 'subseries-b2',
        placement: {
          kind: 'append',
        },
      },
    });

    setWorkspace((previous) => ({
      ...previous,
      seriesDocs: {
        ...previous.seriesDocs,
        [SERIES_A_DOC_NAME]: paired.sourceDoc,
        [SERIES_B_DOC_NAME]: paired.targetDoc,
      },
    }));

    appendActionLog({
      opId: crypto.randomUUID(),
      userId: LOCAL_USER.id,
      createdAt: Date.now(),
      docNames: [SERIES_A_DOC_NAME, SERIES_B_DOC_NAME],
      suggestionIds: [sid],
      promptSummary: 'DEBUG STAGE MOVE file-a2 -> subseries-b2',
      result: 'ok',
    });
  }, [appendActionLog, workspace.seriesDocs]);

  const moveSuggestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const doc of Object.values(workspace.seriesDocs)) {
      for (const suggestion of listBlockSuggestions(doc)) {
        if (suggestion.kind === 'MOVE_SUBTREE_CROSS_SERIES') {
          ids.add(suggestion.sid);
        }
      }
    }
    return Array.from(ids);
  }, [workspace.seriesDocs]);

  const runExport = useCallback(() => {
    const doc = exportCollection({
      manifestDoc: workspace.manifestDoc,
      seriesDocsByDocName: workspace.seriesDocs,
    });
    setExportPreview(JSON.stringify(doc, null, 2));
  }, [workspace]);

  if (!activeSeriesDoc || !activeHierarchy || !currentFocusState) {
    return <div className="app-shell">No active series document loaded.</div>;
  }

  const manifestRoot = workspace.manifestDoc.content[0];
  const activePresenceCount = collectionPresence[workspace.activeSeriesDocName] ?? 0;
  const linkedImages = focusedNode?.level === 'item' ? extractLinkedImages(focusedNode.fields) : [];
  const groupedItemFields = focusedNode?.level === 'item' ? groupItemFieldsForCms(focusedNode.fields) : [];
  const cmsLevelColor = focusedNode ? CMS_LEVEL_COLORS[focusedNode.level] : '#6b7280';
  const metadataByKey = focusedNode?.metadata ?? {};

  return (
    <div className="app-shell">
      <header className="workspace-header">
        <div>
          <p className="workspace-header__kicker">Collaborative Archival Editor</p>
          <h1>{String(manifestRoot.attrs?.title ?? 'Untitled Collection')}</h1>
          <p className="workspace-header__sub">
            Manifest room `collection:{COLLECTION_ID}` + active series room `{workspace.activeSeriesDocName}`
          </p>
        </div>

        <div className="header-actions">
          <div className="mode-toggle" role="tablist" aria-label="Editor mode">
            <button
              type="button"
              role="tab"
              aria-selected={currentFocusState.mode === 'document'}
              className={
                currentFocusState.mode === 'document' ? 'mode-toggle__btn mode-toggle__btn--active' : 'mode-toggle__btn'
              }
              onClick={() =>
                updateCurrentFocusState((state) => ({
                  ...state,
                  mode: 'document',
                  expandedIds: new Set(state.expandedIds),
                }))
              }
            >
              Document View
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={currentFocusState.mode === 'focus'}
              className={
                currentFocusState.mode === 'focus' ? 'mode-toggle__btn mode-toggle__btn--active' : 'mode-toggle__btn'
              }
              onClick={() =>
                updateCurrentFocusState((state) => ({
                  ...state,
                  mode: 'focus',
                  expandedIds: new Set(state.expandedIds),
                }))
              }
            >
              CMS / Focus View
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={currentFocusState.mode === 'json'}
              className={
                currentFocusState.mode === 'json' ? 'mode-toggle__btn mode-toggle__btn--active' : 'mode-toggle__btn'
              }
              onClick={() =>
                updateCurrentFocusState((state) => ({
                  ...state,
                  mode: 'json',
                  expandedIds: new Set(state.expandedIds),
                }))
              }
            >
              JSON View
            </button>
          </div>

          {debugMode ? (
            <button
              type="button"
              className="debug-toggle debug-toggle--active"
              onClick={() => setDebugMode(false)}
              title="Debug mode is active (Ctrl/Cmd+Shift+D toggles)"
            >
              Debug On
            </button>
          ) : null}
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="workspace-rail">
          <section className="panel browser-panel">
            {railPanelMode === 'collections' ? (
              <>
                <h2>Collection Browser</h2>
                <p className="manifest-panel__dates">{String(manifestRoot.attrs?.dates ?? '')}</p>
                <p className="browser-panel__hint">
                  Select a series to open the guided hierarchy editor for that series.
                </p>
                <ul className="manifest-panel__series-list">
                  {seriesRefs.map((series) => {
                    const presence = collectionPresence[series.docName] ?? 0;
                    return (
                      <li key={series.docName}>
                        <button
                          type="button"
                          className={
                            workspace.activeSeriesDocName === series.docName
                              ? 'manifest-series manifest-series--active'
                              : 'manifest-series'
                          }
                          onClick={() => openSeriesFromBrowser(series.docName)}
                        >
                          <span className="manifest-series__order">{series.order}</span>
                          <span className="manifest-series__body">
                            <strong>{series.title}</strong>
                            <small>{series.docName}</small>
                          </span>
                          <span className="manifest-series__presence">{presence} active</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="manifest-panel__presence-note">Current room: {activePresenceCount} active</p>
              </>
            ) : (
              <>
                <div className="browser-panel__header">
                  <button
                    type="button"
                    className="browser-panel__back"
                    onClick={() => setRailPanelMode('collections')}
                  >
                    Back to Collections
                  </button>
                  <div className="browser-panel__series-meta">
                    <h2>{activeSeriesRef?.title ?? 'Guided Hierarchy'}</h2>
                    <p>{workspace.activeSeriesDocName}</p>
                  </div>
                </div>
                <p className="hierarchy-panel__hint">
                  Drag handles reorder siblings within a level, matching PRD-safe hierarchy behavior.
                </p>
                <FindingAidHierarchy
                  root={activeHierarchy}
                  focusState={currentFocusState}
                  presenceByNodeId={presenceByNodeId}
                  onFocus={focusHierarchyNode}
                  onToggleExpand={(id) =>
                    updateCurrentFocusState((state) => {
                      const expandedIds = new Set(state.expandedIds);
                      if (expandedIds.has(id)) {
                        expandedIds.delete(id);
                      } else {
                        expandedIds.add(id);
                      }

                      return {
                        ...state,
                        expandedIds,
                      };
                    })
                  }
                  onMove={applyManualHierarchyMove}
                  onIndent={applyManualHierarchyIndent}
                  onOutdent={applyManualHierarchyOutdent}
                  onAddChild={applyManualHierarchyAddChild}
                  onDelete={applyManualHierarchyDelete}
                  onRename={(id, title) => applyHierarchyMetadataPatch(id, { title })}
                />
              </>
            )}
          </section>
        </aside>

        <main className="workspace-main">
          {currentFocusState.mode === 'document' ? (
            <section className="panel document-panel">
              <h2>Document View</h2>
              <p className="document-panel__hint">
                Word-style finding aid editing backed by canonical `seriesBody` JSON.
              </p>

              <FindingAidEditor
                content={seriesBodyNodes as PMNode[]}
                hierarchyHeadings={hierarchyHeadings}
                onChange={(nextContent) => updateActiveSeriesDoc((doc) => setSeriesBodyNodes(doc, nextContent))}
              />

              <div className="inline-actions inline-actions--document">
                <h3>Inline Suggestions</h3>
                {inlineSuggestions.insertIds.map((sid) => (
                  <div key={`insert-${sid}`} className="inline-action-row">
                    <span>Insert `{sid}`</span>
                    <button type="button" onClick={() => applyInlineSuggestionDecision(sid, 'insert', 'accept')}>
                      Accept
                    </button>
                    <button type="button" onClick={() => applyInlineSuggestionDecision(sid, 'insert', 'reject')}>
                      Reject
                    </button>
                  </div>
                ))}
                {inlineSuggestions.deleteIds.map((sid) => (
                  <div key={`delete-${sid}`} className="inline-action-row">
                    <span>Delete `{sid}`</span>
                    <button type="button" onClick={() => applyInlineSuggestionDecision(sid, 'delete', 'accept')}>
                      Accept
                    </button>
                    <button type="button" onClick={() => applyInlineSuggestionDecision(sid, 'delete', 'reject')}>
                      Reject
                    </button>
                  </div>
                ))}
                {inlineSuggestions.insertIds.length === 0 && inlineSuggestions.deleteIds.length === 0 ? (
                  <p className="inline-action-empty">No inline suggestions currently present.</p>
                ) : null}
              </div>
            </section>
          ) : currentFocusState.mode === 'focus' ? (
            <section className="panel focus-panel cms-panel">
              <h2>CMS / Focus View</h2>
              <p className="cms-panel__hint">Plain forms generated from the focused hierarchy node.</p>

              {focusedNode ? (
                <div
                  className={`cms-shell cms-shell--${focusedNode.level}`}
                  style={{ '--cms-level-color': cmsLevelColor } as CSSProperties}
                >
                  <header className="cms-shell__header">
                    <div>
                      <span className="cms-shell__level">{focusedNode.level.toUpperCase()}</span>
                      <h3 className="cms-screen-title">{renderCmsScreenTitle(focusedNode.level)}</h3>
                    </div>
                    {focusedNode.itemType ? <span className="cms-shell__item-type">{focusedNode.itemType}</span> : null}
                  </header>

                  <p className="cms-shell__node-id">Focused node: {focusedNode.id}</p>

                  {debugMode ? (
                    <div className="focused-meta">
                      <span className="focused-meta__chip">id: {focusedNode.id}</span>
                      <span className="focused-meta__chip">level: {focusedNode.level}</span>
                      {focusedNode.itemType ? (
                        <span className="focused-meta__chip">itemType: {focusedNode.itemType}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {(focusedNode.level === 'series' ||
                    focusedNode.level === 'subseries' ||
                    focusedNode.level === 'file') ? (
                    <>
                      <section className="cms-section">
                        <h4 className="cms-section__title">Title</h4>
                        <label className="field-input" htmlFor="title-editor">
                          <span>Title</span>
                          <input
                            id="title-editor"
                            className="title-editor"
                            value={focusedNode.title}
                            onChange={(event) => {
                              const title = event.target.value;
                              applyHierarchyMetadataPatch(focusedNode.id, { title });
                            }}
                          />
                        </label>
                      </section>

                      {(['Core Metadata', 'Arrangement & Scope', 'Access & Rights', 'Digital'] as const).map((section) => {
                        const fields = CMS_FIELDS.filter((entry) => entry.section === section);
                        return (
                          <section key={section} className="cms-section">
                            <h4 className="cms-section__title">{section}</h4>
                            <div className="field-grid">
                              {fields.map((field) => (
                                <CmsMetadataInput
                                  key={`${focusedNode.id}-${field.key}`}
                                  label={field.label}
                                  value={metadataByKey[field.key] ?? ''}
                                  placeholder={field.placeholder}
                                  multiline={field.multiline}
                                  onChange={(nextValue) =>
                                    applyHierarchyMetadataPatch(focusedNode.id, { [field.key]: nextValue })
                                  }
                                />
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </>
                  ) : null}

                  {focusedNode.level === 'item' ? (
                    <>
                      <section className="cms-section">
                        <h4 className="cms-section__title">Linked Images</h4>
                        {linkedImages.length > 0 ? (
                          <div className="cms-image-grid">
                            {linkedImages.map((link) => (
                              <a
                                key={link.fieldId}
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                className="cms-image-card"
                              >
                                <img src={link.url} alt={link.label} loading="lazy" />
                                <span>{link.label}</span>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="cms-empty-note">
                            No linked image URLs detected yet. Add `imageUrl` or `thumbnailUrl` item fields.
                          </p>
                        )}
                      </section>

                      <section className="cms-section">
                        <h4 className="cms-section__title">Item Metadata</h4>
                        <div className="cms-item-groups">
                          {groupedItemFields.map((group) => (
                            <article key={`${focusedNode.id}-${group.groupKey}`} className="cms-item-group">
                              <h5>{group.groupLabel}</h5>
                              <div className="field-grid">
                                {group.fields.map((field) => (
                                  <FieldInput
                                    key={field.fieldId}
                                    field={field}
                                    onChange={(value) => {
                                      updateActiveSeriesDoc((doc) =>
                                        updateItemFieldValue(doc, focusedNode.id, field.fieldId, value),
                                      );
                                    }}
                                  />
                                ))}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    </>
                  ) : null}
                </div>
              ) : (
                <p>Select a node in the hierarchy rail.</p>
              )}
            </section>
          ) : (
            <section className="panel json-panel">
              <h2>JSON View</h2>
              <p className="json-panel__hint">
                Raw TipTap JSON under the hood: persisted `seriesBody` and the editor-rendered doc after hierarchy normalization.
              </p>

              <div className="json-panel__block">
                <h3>Persisted `seriesBody` JSON (canonical, section-bound)</h3>
                <pre>{JSON.stringify(persistedSeriesBodyJson, null, 2)}</pre>
              </div>

              <div className="json-panel__block">
                <h3>Editor `doc` JSON (rendered)</h3>
                <pre>{JSON.stringify(findingAidDocJson, null, 2)}</pre>
              </div>
            </section>
          )}

          {debugMode ? (
            <section className="panel operations-panel">
            <h2>Operations Rail</h2>
            <p className="operations-panel__hint">
              Structural `suggestion_block` proposals with deterministic accept/reject semantics.
            </p>

            <div className="cross-series-playground">
              <h3>Cross-Series Playground</h3>
              <p>
                Seed and test inter-series moves in this collection. Current pending move proposals: {moveSuggestionIds.length}
              </p>
              <div className="cross-series-playground__actions">
                <button type="button" onClick={() => openSeriesFromBrowser(SERIES_A_DOC_NAME)}>
                  Open Series A
                </button>
                <button type="button" onClick={() => openSeriesFromBrowser(SERIES_B_DOC_NAME)}>
                  Open Series B
                </button>
                <button type="button" onClick={stageCrossSeriesMoveProposal}>
                  Stage Move A → B (file-a2)
                </button>
              </div>
            </div>

            {Array.from(suggestionsByGroup.entries()).map(([groupId, ids]) => (
              <div key={groupId} className="group-actions">
                <span>
                  Group `{groupId}` ({ids.length})
                </span>
                <button type="button" onClick={() => applyGroupDecision(groupId, 'accept')}>
                  Accept Group
                </button>
                <button type="button" onClick={() => applyGroupDecision(groupId, 'reject')}>
                  Reject Group
                </button>
              </div>
            ))}

            <div className="suggestion-list">
              {blockSuggestions.map((suggestion) => (
                <article
                  key={suggestion.sid}
                  className={suggestion.stale ? 'suggestion-card suggestion-card--stale' : 'suggestion-card'}
                >
                  <header>
                    <strong>{suggestion.kind}</strong>
                    <span>{suggestion.author}</span>
                  </header>

                  <p className="suggestion-card__meta">
                    sid: {suggestion.sid}
                    {suggestion.groupId ? ` | group: ${suggestion.groupId}` : ''}
                    {suggestion.stale && suggestion.staleReason ? ` | stale: ${suggestion.staleReason}` : ''}
                  </p>

                  {debugMode ? (
                    <pre className="suggestion-card__payload">{JSON.stringify(suggestion.payload, null, 2)}</pre>
                  ) : null}

                  <div className="suggestion-card__actions">
                    <button
                      type="button"
                      disabled={suggestion.stale}
                      onClick={() => applyBlockSuggestionDecision(suggestion.sid, 'accept')}
                    >
                      Accept
                    </button>
                    <button type="button" onClick={() => applyBlockSuggestionDecision(suggestion.sid, 'reject')}>
                      Reject
                    </button>
                  </div>
                </article>
              ))}
              {blockSuggestions.length === 0 ? <p>No pending block suggestions in this series.</p> : null}
            </div>

            <div className="export-block">
              <button type="button" onClick={runExport}>
                Export Monolithic Collection
              </button>
              {exportPreview ? <pre>{exportPreview}</pre> : null}
            </div>

              <div className="action-log">
                <h3>Agent Action Log</h3>
                {logEntries.map((entry) => (
                  <p key={entry.opId} className={entry.result === 'ok' ? 'log-entry' : 'log-entry log-entry--failed'}>
                    {new Date(entry.createdAt).toLocaleTimeString()} | {entry.promptSummary ?? entry.opId} | {entry.result}
                    {entry.errorMessage ? ` | ${entry.errorMessage}` : ''}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

type FieldInputProps = {
  field: ItemFieldModel;
  onChange: (value: string | number | boolean | null) => void;
};

function FieldInput({ field, onChange }: FieldInputProps) {
  const selectOptions = getSelectOptions(field);
  const label = field.groupKey ? `${field.groupKey}.${field.key}` : field.key;

  if (field.valueType === 'boolean') {
    return (
      <label className="field-input field-input--boolean">
        <span>{label}</span>
        <input type="checkbox" checked={Boolean(field.value)} onChange={(event) => onChange(event.target.checked)} />
      </label>
    );
  }

  if (field.valueType === 'number') {
    return (
      <label className="field-input">
        <span>{label}</span>
        <input
          type="number"
          value={field.value == null ? '' : String(field.value)}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (next.length === 0) {
              onChange(null);
              return;
            }

            const asNumber = Number(next);
            if (!Number.isNaN(asNumber)) {
              onChange(asNumber);
            }
          }}
        />
      </label>
    );
  }

  if (field.valueType === 'select' && selectOptions.length > 0) {
    return (
      <label className="field-input">
        <span>{label}</span>
        <select value={String(field.value ?? '')} onChange={(event) => onChange(event.target.value)}>
          {selectOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="field-input">
      <span>{label}</span>
      <input
        type="text"
        value={field.value == null ? '' : String(field.value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type CmsMetadataInputProps = {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onChange: (value: string) => void;
};

function CmsMetadataInput({ label, value, placeholder, multiline, onChange }: CmsMetadataInputProps) {
  if (multiline) {
    return (
      <label className="field-input">
        <span>{label}</span>
        <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  return (
    <label className="field-input">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

type CmsFieldGroup = {
  groupKey: string;
  groupLabel: string;
  fields: ItemFieldModel[];
};

function groupItemFieldsForCms(fields: ItemFieldModel[]): CmsFieldGroup[] {
  const grouped = new Map<string, ItemFieldModel[]>();

  for (const field of fields) {
    const key = field.groupKey ?? 'core';
    const existing = grouped.get(key) ?? [];
    existing.push(field);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .map(([groupKey, groupedFields]) => ({
      groupKey,
      groupLabel: toTitleCase(groupKey),
      fields: groupedFields,
    }))
    .sort((left, right) => left.groupLabel.localeCompare(right.groupLabel));
}

type LinkedImage = {
  fieldId: string;
  label: string;
  url: string;
};

function extractLinkedImages(fields: ItemFieldModel[]): LinkedImage[] {
  return fields
    .filter((field) => typeof field.value === 'string')
    .filter((field) => /^https?:\/\//i.test(String(field.value)))
    .filter((field) => {
      const key = field.key.toLowerCase();
      const value = String(field.value).toLowerCase();
      return (
        key.includes('image') ||
        key.includes('thumbnail') ||
        key.includes('iiif') ||
        key.includes('url') ||
        value.endsWith('.jpg') ||
        value.endsWith('.jpeg') ||
        value.endsWith('.png') ||
        value.endsWith('.webp') ||
        value.includes('picsum.photos')
      );
    })
    .map((field) => ({
      fieldId: field.fieldId,
      label: toTitleCase(field.key),
      url: String(field.value),
    }));
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readManifestSeriesRefs(manifest: CollectionManifestDoc): ManifestSeriesRef[] {
  const root = manifest.content[0];
  const nodes = root.content ?? [];

  const refs: ManifestSeriesRef[] = [];
  for (const node of nodes) {
    if (node.type !== 'seriesRef') {
      continue;
    }

    const attrs = (node as PMNode).attrs ?? {};
    refs.push({
      seriesId: String(attrs.seriesId ?? ''),
      title: String(attrs.title ?? 'Untitled Series'),
      order: Number(attrs.order ?? 0),
      docName: String(attrs.docName ?? ''),
    });
  }

  return refs.sort((a, b) => a.order - b.order);
}

function renderCmsScreenTitle(level: 'series' | 'subseries' | 'file' | 'item'): string {
  if (level === 'series') {
    return 'Series Data Entry Screen';
  }
  if (level === 'subseries') {
    return 'Subseries Data Entry Screen';
  }
  if (level === 'file') {
    return 'File Data Entry Screen';
  }
  return 'Item Data Entry Screen';
}

function flattenHierarchyHeadingsForDocument(root: HierarchyNode): HierarchyHeading[] {
  const headings: HierarchyHeading[] = [];

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

function createInitialWorkspace(): WorkspaceState {
  const manifestDoc = structuredClone(manifestFixture) as CollectionManifestDoc;
  const sourceDoc = createSeriesAStub();
  let targetDoc = createSeriesBStub();
  const tertiaryDoc = createSeriesCStub();
  const quaternaryDoc = createSeriesDStub();

  targetDoc = injectInlineSuggestionParagraphs(targetDoc);
  targetDoc = appendSeriesOpSuggestion(
    targetDoc,
    structuredClone(suggestionCreateItemFixture) as unknown as SuggestionBlockNode,
  );
  targetDoc = appendSeriesOpSuggestion(
    targetDoc,
    structuredClone(suggestionReorderFixture) as unknown as SuggestionBlockNode,
  );

  targetDoc = appendSeriesOpSuggestion(
    targetDoc,
    createSuggestionBlockNode({
      sid: 'sug-group-ui-1',
      groupId: 'group-ui-1',
      kind: 'SET_FIELD',
      author: 'LLM',
      payload: {
        itemId: 'item-photo-001',
        key: 'takenBy',
        valueType: 'text',
        value: 'Archivist Staff',
      },
    }),
  );

  targetDoc = appendSeriesOpSuggestion(
    targetDoc,
    createSuggestionBlockNode({
      sid: 'sug-group-ui-2',
      groupId: 'group-ui-1',
      kind: 'SET_FIELD',
      author: 'LLM',
      payload: {
        itemId: 'item-photo-001',
        key: 'materialType',
        valueType: 'select',
        value: 'digital',
      },
    }),
  );

  const movePayload = (suggestionMoveFixture as any).attrs.payload;
  const moveSid = (suggestionMoveFixture as any).attrs.sid as string;

  const paired = createPairedMoveProposals({
    sourceDoc,
    targetDoc,
    payload: movePayload,
    sid: moveSid,
    author: 'LLM',
    createdAt: Date.now(),
  });

  const seededSource = syncSeriesBodyWithHierarchy(paired.sourceDoc);
  const seededTarget = syncSeriesBodyWithHierarchy(paired.targetDoc);
  const seededTertiary = syncSeriesBodyWithHierarchy(tertiaryDoc);
  const seededQuaternary = syncSeriesBodyWithHierarchy(quaternaryDoc);

  return {
    manifestDoc,
    seriesDocs: {
      [SERIES_A_DOC_NAME]: seededSource,
      [SERIES_B_DOC_NAME]: seededTarget,
      [SERIES_C_DOC_NAME]: seededTertiary,
      [SERIES_D_DOC_NAME]: seededQuaternary,
    },
    activeSeriesDocName: SERIES_B_DOC_NAME,
  };
}

function injectInlineSuggestionParagraphs(doc: SeriesDoc): SeriesDoc {
  const next = structuredClone(doc);
  const seriesRoot = next.content[0];
  const seriesBody = seriesRoot.content?.find((node) => node.type === 'seriesBody');

  if (!seriesBody) {
    return next;
  }

  seriesBody.content = [
    structuredClone(inlineInsertParagraphFixture) as PMNode,
    structuredClone(inlineDeleteParagraphFixture) as PMNode,
  ];

  return next;
}

function createSeriesAStub(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: 'series-a',
          title: 'Administrative Records',
          dates: '1910-1942',
          refCode: 'RR-MS-001',
          extent: '14 linear feet',
          language: 'English',
          arrangement: 'By department and document type.',
          scopeContent: 'Governance and administrative records documenting corporate operations.',
          accessRestrictions: 'Personnel records restricted for 75 years.',
          processingStatus: 'processed',
          digitalObjectUrl: 'https://example.org/collections/rr/series-a',
        },
        content: [
          {
            type: 'seriesOps',
            content: [],
          },
          {
            type: 'seriesBody',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Administrative correspondence and internal policy records.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Includes budgets, governance notes, and executive correspondence.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-a1',
              title: 'Operations Files',
              dates: '1920-1936',
              refCode: 'RR-MS-001.1',
              extent: '7 linear feet',
              arrangement: 'Chronological',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-a1', 'Board Meeting Minutes', [
                createItemNode(
                  'item-minute-001',
                  'document',
                  'Typed board minutes with attendance and resolutions.',
                  '1930-03-14',
                ),
              ]),
              createFileNode('file-a2', 'Budget Reports', [
                createItemNode(
                  'item-budget-001',
                  'document',
                  'Annual budget spreadsheet and notes.',
                  '1931-01-05',
                ),
              ]),
              {
                type: 'file',
                attrs: {
                  id: 'file-a3',
                  title: 'Dispatch Ledgers',
                },
                content: [
                  {
                    type: 'item',
                    attrs: {
                      id: 'item-ledger-001',
                      itemType: 'document',
                    },
                    content: [
                      {
                        type: 'itemFields',
                        content: [
                          {
                            type: 'field',
                            attrs: {
                              id: 'field-ledger-1',
                              key: 'transcription',
                              valueType: 'text',
                              value: 'Dispatch ledger with train movement notes.',
                            },
                          },
                          {
                            type: 'field',
                            attrs: {
                              id: 'field-ledger-2',
                              key: 'date',
                              valueType: 'date',
                              value: '1932-05-12',
                            },
                          },
                        ],
                      },
                      {
                        type: 'itemBody',
                        content: [
                          {
                            type: 'paragraph',
                            content: [
                              {
                                type: 'text',
                                text: 'Ledger entries from Springfield dispatch office.',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-a2',
              title: 'Executive Correspondence',
              dates: '1928-1942',
              refCode: 'RR-MS-001.2',
              extent: '3 linear feet',
              arrangement: 'By correspondent',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-a4', 'Directors Letters', [
                createItemNode(
                  'item-letter-001',
                  'document',
                  'Signed letter between board directors regarding expansion plans.',
                  '1932-11-21',
                ),
              ]),
            ],
          },
        ],
      },
    ],
  };
}

function createSeriesBStub(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: 'series-b',
          title: 'Photographic Materials',
          dates: '1919-1941',
          refCode: 'RR-MS-002',
          extent: '2,340 photographic prints and negatives',
          language: 'English',
          arrangement: 'By subject and location.',
          scopeContent: 'Station, rolling stock, and staff photography across the railroad network.',
          accessRestrictions: 'Fragile negatives restricted to supervised use.',
          processingStatus: 'in-progress',
          digitalObjectUrl: 'https://example.org/collections/rr/series-b',
        },
        content: [
          {
            type: 'seriesOps',
            content: [],
          },
          {
            type: 'seriesBody',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Photographs documenting railroad infrastructure and staff.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-b1',
              title: 'Station Photographs',
              dates: '1920-1938',
              refCode: 'RR-MS-002.1',
              extent: '1,200 prints',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-b1-1', 'Union Station, 1920s', [
                createItemNode(
                  'item-photo-001',
                  'photograph',
                  'View of Union Station from the south entrance.',
                  '1924',
                ),
                createItemNode(
                  'item-photo-002',
                  'photograph',
                  'Interior ticket hall with passengers at counters.',
                  '1925',
                ),
              ]),
              createFileNode('file-b1-2', 'Freight Yard, 1930s', [
                createItemNode(
                  'item-photo-010',
                  'photograph',
                  'Rail cars lined up in the north freight yard.',
                  '1934',
                ),
              ]),
              createFileNode('file-b1-3', 'Track Maintenance', [
                createItemNode(
                  'item-photo-020',
                  'photograph',
                  'Crew replacing rails near mile marker 18.',
                  '1936',
                ),
              ]),
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-b2',
              title: 'Personnel Portraits',
              dates: '1929-1941',
              refCode: 'RR-MS-002.2',
              extent: '400 prints',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-b2-1', 'Staff Portraits', [
                createItemNode(
                  'item-photo-100',
                  'photograph',
                  'Formal portrait of station staff in uniform.',
                  '1931',
                ),
              ]),
            ],
          },
        ],
      },
    ],
  };
}

function createSeriesCStub(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: 'series-c',
          title: 'Engineering Drawings',
          dates: '1901-1948',
          refCode: 'RR-MS-003',
          extent: '180 oversize sheets',
          language: 'English',
          arrangement: 'By line segment and drawing type.',
          scopeContent: 'Track, bridge, and station engineering drawings, including revisions.',
          accessRestrictions: 'Oversize items require supervised handling.',
          processingStatus: 'processed',
          digitalObjectUrl: 'https://example.org/collections/rr/series-c',
        },
        content: [
          {
            type: 'seriesOps',
            content: [],
          },
          {
            type: 'seriesBody',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Technical drawings and plans created by the engineering division.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-c1',
              title: 'Bridge Blueprints',
              dates: '1901-1930',
              refCode: 'RR-MS-003.1',
              extent: '60 sheets',
              arrangement: 'By bridge number',
              processingStatus: 'processed',
            },
            content: [
              createFileNode(
                'file-c1-1',
                'Bridge 14 - Original Design',
                [createItemNode('item-blueprint-001', 'document', 'Steel truss bridge elevation and notes.', '1904-06-03')],
                {
                  dates: '1904',
                  refCode: 'RR-MS-003.1.1',
                  extent: '12 sheets',
                  language: 'English',
                },
              ),
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-c2',
              title: 'Station Floorplans',
              dates: '1918-1948',
              refCode: 'RR-MS-003.2',
              extent: '120 sheets',
              arrangement: 'By station name',
              processingStatus: 'in-progress',
            },
            content: [
              createFileNode(
                'file-c2-1',
                'Union Station Renovation',
                [createItemNode('item-floorplan-001', 'document', 'Floorplan revisions showing new ticket office layout.', '1938-09-01')],
                {
                  dates: '1938-1940',
                  refCode: 'RR-MS-003.2.1',
                  extent: '24 sheets',
                  language: 'English',
                },
              ),
            ],
          },
        ],
      },
    ],
  };
}

function createSeriesDStub(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: 'series-d',
          title: 'Oral Histories',
          dates: '1978-1992',
          refCode: 'RR-MS-004',
          extent: '42 interviews',
          language: 'English',
          arrangement: 'By interviewee surname.',
          scopeContent: 'Recorded interviews with former employees and family members.',
          accessRestrictions: 'Audio files available onsite only.',
          processingStatus: 'minimally-processed',
          digitalObjectUrl: 'https://example.org/collections/rr/series-d',
        },
        content: [
          {
            type: 'seriesOps',
            content: [],
          },
          {
            type: 'seriesBody',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Interviews documenting labor history, station life, and community impact.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-d1',
              title: 'Audio Cassettes',
              dates: '1978-1985',
              refCode: 'RR-MS-004.1',
              extent: '28 cassettes',
              processingStatus: 'processed',
            },
            content: [
              createFileNode(
                'file-d1-1',
                'Interview - Conductor James Bell',
                [createItemNode('item-oral-001', 'object', 'Audio interview discussing route safety and schedules.', '1980-05-16')],
                {
                  dates: '1980',
                  refCode: 'RR-MS-004.1.1',
                  extent: '1 cassette',
                },
              ),
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-d2',
              title: 'Typed Transcripts',
              dates: '1980-1992',
              refCode: 'RR-MS-004.2',
              extent: '14 folders',
              processingStatus: 'processed',
            },
            content: [
              createFileNode(
                'file-d2-1',
                'Transcript - Maintenance Crew',
                [createItemNode('item-oral-050', 'document', 'Transcript of maintenance crew group interview.', '1982-10-09')],
                {
                  dates: '1982',
                  refCode: 'RR-MS-004.2.1',
                  extent: '34 pages',
                },
              ),
            ],
          },
        ],
      },
    ],
  };
}

function createFileNode(
  fileId: string,
  title: string,
  items: PMNode[],
  metadata: Record<string, string> = {},
): PMNode {
  return {
    type: 'file',
    attrs: {
      id: fileId,
      title,
      ...metadata,
    },
    content: items,
  };
}

function createItemNode(
  itemId: string,
  itemType: 'photograph' | 'document' | 'object',
  description: string,
  date: string,
): PMNode {
  const isPhotograph = itemType === 'photograph';
  const imageUrl = isPhotograph ? `https://picsum.photos/seed/${itemId}/900/620` : '';
  const thumbnailUrl = isPhotograph ? `https://picsum.photos/seed/${itemId}-thumb/360/240` : '';

  return {
    type: 'item',
    attrs: {
      id: itemId,
      itemType,
    },
    content: [
      {
        type: 'itemFields',
        content: [
          {
            type: 'field',
            attrs: {
              id: `${itemId}-title`,
              key: 'title',
              valueType: 'text',
              value: description.slice(0, 90),
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-subjects`,
              key: 'subjects',
              valueType: 'text',
              value: description,
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-creator`,
              key: 'creator',
              valueType: 'text',
              value: 'Unknown creator',
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-date`,
              key: 'date',
              valueType: 'date',
              value: date,
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-material`,
              key: 'materialType',
              valueType: 'select',
              value: isPhotograph ? 'print' : 'digital',
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-rights`,
              key: 'rightsStatus',
              valueType: 'select',
              value: 'copyright-undetermined',
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-condition`,
              key: 'condition',
              valueType: 'select',
              value: 'good',
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-digitization`,
              key: 'digitizationStatus',
              valueType: 'select',
              value: isPhotograph ? 'digitized' : 'not-digitized',
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-image-url`,
              key: 'imageUrl',
              valueType: 'text',
              value: imageUrl,
            },
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-thumb-url`,
              key: 'thumbnailUrl',
              valueType: 'text',
              value: thumbnailUrl,
            },
          },
          {
            type: 'fieldGroup',
            attrs: {
              id: `${itemId}-height-group`,
              groupKey: 'height',
            },
            content: [
              {
                type: 'field',
                attrs: {
                  id: `${itemId}-height-value`,
                  key: 'value',
                  valueType: 'number',
                  value: isPhotograph ? 24 : 12,
                },
              },
              {
                type: 'field',
                attrs: {
                  id: `${itemId}-height-unit`,
                  key: 'unit',
                  valueType: 'select',
                  value: 'cm',
                },
              },
            ],
          },
          {
            type: 'fieldGroup',
            attrs: {
              id: `${itemId}-weight-group`,
              groupKey: 'weight',
            },
            content: [
              {
                type: 'field',
                attrs: {
                  id: `${itemId}-weight-value`,
                  key: 'value',
                  valueType: 'number',
                  value: isPhotograph ? 120 : 340,
                },
              },
              {
                type: 'field',
                attrs: {
                  id: `${itemId}-weight-unit`,
                  key: 'unit',
                  valueType: 'select',
                  value: 'g',
                },
              },
            ],
          },
          {
            type: 'field',
            attrs: {
              id: `${itemId}-pii`,
              key: 'pii',
              valueType: 'boolean',
              value: false,
            },
          },
        ],
      },
      {
        type: 'itemBody',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: description,
              },
            ],
          },
        ],
      },
    ],
  };
}

function findParentId(root: HierarchyNode, nodeId: string, parentId: string | null = null): string | null {
  if (root.id === nodeId) {
    return parentId;
  }

  for (const child of root.children) {
    const found = findParentId(child, nodeId, root.id);
    if (found) {
      return found;
    }
  }

  return null;
}
