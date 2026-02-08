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
  moveSeriesRef,
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
import historiqLogo from './assets/historiq-logo.svg';
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
import { userInitials } from './lib/user';

type ManifestSeriesRef = {
  seriesId: string;
  title: string;
  order: number;
  docName: string;
};

type WorkspaceState = {
  manifestsByCollectionId: Record<string, CollectionManifestDoc>;
  collectionOrder: string[];
  seriesDocs: Record<string, SeriesDoc>;
  activeCollectionId: string;
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

const PRIMARY_COLLECTION_ID = 'col-001';
const SECONDARY_COLLECTION_ID = 'col-002';

const SERIES_A_DOC_NAME = seriesDocName(PRIMARY_COLLECTION_ID, 'series-a');
const SERIES_B_DOC_NAME = seriesDocName(PRIMARY_COLLECTION_ID, 'series-b');
const SERIES_C_DOC_NAME = seriesDocName(PRIMARY_COLLECTION_ID, 'series-c');
const SERIES_D_DOC_NAME = seriesDocName(SECONDARY_COLLECTION_ID, 'series-d');
const SERIES_E_DOC_NAME = seriesDocName(SECONDARY_COLLECTION_ID, 'series-e');
const SERIES_F_DOC_NAME = seriesDocName(SECONDARY_COLLECTION_ID, 'series-f');

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

const LOCAL_USER = { id: 'user-local', name: 'Archivist Reviewer', color: '#ff5757' };
const PEER_USER = { id: 'user-peer', name: 'Peer Reviewer', color: '#3b82f6' };
const LOCAL_USER_INITIALS = userInitials(LOCAL_USER.name);
const DEFAULT_INSTITUTION_NAME = 'Great Lakes Railroad Historical Society';

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createInitialWorkspace());
  const [focusStateByDoc, setFocusStateByDoc] = useState<FocusStateMap>({});
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [railPanelMode, setRailPanelMode] = useState<RailPanelMode>('collections');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(null);
  const [collectionTitleMenuOpenId, setCollectionTitleMenuOpenId] = useState<string | null>(null);
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [collectionTitleDraft, setCollectionTitleDraft] = useState('');
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

  const activeManifestDoc = useMemo(
    () => workspace.manifestsByCollectionId[workspace.activeCollectionId] ?? null,
    [workspace.activeCollectionId, workspace.manifestsByCollectionId],
  );

  const seriesRefs = useMemo(() => {
    if (!activeManifestDoc) {
      return [] as ManifestSeriesRef[];
    }
    return readManifestSeriesRefs(activeManifestDoc);
  }, [activeManifestDoc]);

  const collectionEntries = useMemo(() => {
    return workspace.collectionOrder
      .map((collectionId) => {
        const manifest = workspace.manifestsByCollectionId[collectionId];
        if (!manifest) {
          return null;
        }

        const root = manifest.content[0];
        const refs = readManifestSeriesRefs(manifest);
        const activeCount = refs.reduce((sum, ref) => sum + (collectionPresence[ref.docName] ?? 0), 0);
        return {
          collectionId,
          title: String(root.attrs?.title ?? 'Untitled Collection'),
          description: readCollectionDescription(manifest),
          dates: String(root.attrs?.dates ?? ''),
          seriesRefs: refs,
          activeCount,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  }, [workspace.collectionOrder, workspace.manifestsByCollectionId, collectionPresence]);

  const filteredCollectionEntries = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    if (!query) {
      return collectionEntries;
    }

    return collectionEntries.filter((entry) => {
      return (
        entry.title.toLowerCase().includes(query) ||
        entry.collectionId.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query)
      );
    });
  }, [collectionEntries, collectionSearch]);

  const activeSeriesRef = useMemo(
    () => seriesRefs.find((series) => series.docName === workspace.activeSeriesDocName) ?? null,
    [seriesRefs, workspace.activeSeriesDocName],
  );

  const activeCollectionDescription = useMemo(() => {
    if (!activeManifestDoc) {
      return '';
    }
    return readCollectionDescription(activeManifestDoc);
  }, [activeManifestDoc]);

  const activeInstitutionName = useMemo(() => {
    if (!activeManifestDoc) {
      return 'Institution Name';
    }
    return readCollectionInstitution(activeManifestDoc);
  }, [activeManifestDoc]);

  useEffect(() => {
    if (seriesRefs.length === 0) {
      return;
    }

    if (seriesRefs.some((series) => series.docName === workspace.activeSeriesDocName)) {
      return;
    }

    const fallbackDocName = seriesRefs[0]?.docName;
    if (!fallbackDocName) {
      return;
    }

    setWorkspace((previous) => ({
      ...previous,
      activeSeriesDocName: fallbackDocName,
    }));
  }, [seriesRefs, workspace.activeSeriesDocName]);

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
        [workspace.activeSeriesDocName]: createFocusStateForHierarchy(activeHierarchy),
      };
    });
  }, [activeHierarchy, workspace.activeSeriesDocName]);

  const currentFocusState =
    activeHierarchy && focusStateByDoc[workspace.activeSeriesDocName]
      ? focusStateByDoc[workspace.activeSeriesDocName]
      : activeHierarchy
        ? createFocusStateForHierarchy(activeHierarchy)
        : null;

  const updateCurrentFocusState = useCallback(
    (updater: (state: FocusState) => FocusState) => {
      if (!activeHierarchy) {
        return;
      }

      setFocusStateByDoc((previous) => {
        const current = previous[workspace.activeSeriesDocName] ?? createFocusStateForHierarchy(activeHierarchy);
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
      expandedIds: state.expandedIds.size > 0 ? new Set(state.expandedIds) : collectHierarchyIds(activeHierarchy),
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

  const workspaceCollectionsJson = useMemo(
    () => ({
      activeCollectionId: workspace.activeCollectionId,
      activeSeriesDocName: workspace.activeSeriesDocName,
      collectionOrder: workspace.collectionOrder,
      manifestsByCollectionId: workspace.manifestsByCollectionId,
    }),
    [
      workspace.activeCollectionId,
      workspace.activeSeriesDocName,
      workspace.collectionOrder,
      workspace.manifestsByCollectionId,
    ],
  );

  const activeFocusStateJson = useMemo(() => {
    if (!currentFocusState) {
      return null;
    }

    return {
      ...currentFocusState,
      expandedIds: Array.from(currentFocusState.expandedIds),
    };
  }, [currentFocusState]);

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

  const updateCollectionManifest = useCallback(
    (collectionId: string, updater: (manifest: CollectionManifestDoc) => CollectionManifestDoc) => {
      setWorkspace((previous) => {
        const current = previous.manifestsByCollectionId[collectionId];
        if (!current) {
          return previous;
        }

        return {
          ...previous,
          manifestsByCollectionId: {
            ...previous.manifestsByCollectionId,
            [collectionId]: updater(current),
          },
        };
      });
    },
    [],
  );

  const renameCollectionTitle = useCallback(
    (collectionId: string, title: string) => {
      updateCollectionManifest(collectionId, (manifest) => {
        const next = structuredClone(manifest);
        const root = next.content[0];
        root.attrs = {
          ...(root.attrs ?? {}),
          title,
        };
        return next;
      });
    },
    [updateCollectionManifest],
  );

  const setActiveSeriesDocName = useCallback((docName: string) => {
    setWorkspace((previous) => {
      if (!previous.seriesDocs[docName]) {
        return previous;
      }

      return {
        ...previous,
        activeSeriesDocName: docName,
      };
    });
  }, []);

  const setActiveCollectionId = useCallback((collectionId: string) => {
    setWorkspace((previous) => {
      const manifest = previous.manifestsByCollectionId[collectionId];
      if (!manifest) {
        return previous;
      }

      const refs = readManifestSeriesRefs(manifest);
      const nextActiveDocName =
        refs.find((ref) => ref.docName === previous.activeSeriesDocName)?.docName ?? refs[0]?.docName ?? null;

      if (!nextActiveDocName) {
        return previous;
      }

      return {
        ...previous,
        activeCollectionId: collectionId,
        activeSeriesDocName: nextActiveDocName,
      };
    });
  }, []);

  const openCollectionFromBrowser = useCallback(
    (collectionId: string) => {
      setActiveCollectionId(collectionId);
      setRailPanelMode('hierarchy');
    },
    [setActiveCollectionId],
  );

  const beginCollectionTitleRename = useCallback(
    (collectionId: string, title: string) => {
      setCollectionTitleMenuOpenId(null);
      setRenamingCollectionId(collectionId);
      setCollectionTitleDraft(title);
      setActiveCollectionId(collectionId);
    },
    [setActiveCollectionId],
  );

  const commitCollectionTitleRename = useCallback(
    (collectionId: string) => {
      if (renamingCollectionId !== collectionId) {
        return;
      }
      const nextTitle = collectionTitleDraft.trim().length > 0 ? collectionTitleDraft.trim() : 'Untitled Collection';
      renameCollectionTitle(collectionId, nextTitle);
      setRenamingCollectionId(null);
    },
    [collectionTitleDraft, renameCollectionTitle, renamingCollectionId],
  );

  const cancelCollectionTitleRename = useCallback(() => {
    setRenamingCollectionId(null);
    setCollectionTitleDraft('');
  }, []);

  const openSeriesInHierarchy = useCallback(
    (docName: string) => {
      setActiveSeriesDocName(docName);
    },
    [setActiveSeriesDocName],
  );

  const focusHierarchyNode = useCallback(
    (id: string) => {
      updateCurrentFocusState((state) => ({
        ...state,
        focusedId: id,
        expandedIds: new Set(state.expandedIds),
      }));
      setFocusRequestKey((value) => value + 1);
    },
    [updateCurrentFocusState],
  );

  const focusHierarchyNodeFromDocument = useCallback(
    (id: string) => {
      if (!activeHierarchy || !nodeExists(activeHierarchy, id) || currentFocusState?.focusedId === id) {
        return;
      }

      updateCurrentFocusState((state) => ({
        ...state,
        focusedId: id,
        expandedIds: new Set(state.expandedIds),
      }));
    },
    [activeHierarchy, currentFocusState?.focusedId, updateCurrentFocusState],
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

  const applyManifestSeriesMove = useCallback(
    (draggedDocName: string, targetDocName: string, placement: 'before' | 'after') => {
      if (!activeManifestDoc) {
        return;
      }

      const refs = readManifestSeriesRefs(activeManifestDoc);
      const fromIndex = refs.findIndex((ref) => ref.docName === draggedDocName);
      const targetIndex = refs.findIndex((ref) => ref.docName === targetDocName);
      if (fromIndex < 0 || targetIndex < 0) {
        return;
      }

      let toIndex = placement === 'before' ? targetIndex : targetIndex + 1;
      if (fromIndex < toIndex) {
        toIndex -= 1;
      }

      if (toIndex === fromIndex) {
        return;
      }

      setWorkspace((previous) => {
        const manifest = previous.manifestsByCollectionId[previous.activeCollectionId];
        if (!manifest) {
          return previous;
        }

        return {
          ...previous,
          manifestsByCollectionId: {
            ...previous.manifestsByCollectionId,
            [previous.activeCollectionId]: moveSeriesRef(manifest, fromIndex, toIndex),
          },
        };
      });

      appendActionLog({
        opId: crypto.randomUUID(),
        userId: LOCAL_USER.id,
        createdAt: Date.now(),
        docNames: [draggedDocName, targetDocName],
        suggestionIds: [],
        promptSummary: `MANUAL REORDER SERIES ${draggedDocName} ${placement} ${targetDocName}`,
        result: 'ok',
      });
    },
    [activeManifestDoc, appendActionLog],
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
    if (workspace.activeCollectionId !== PRIMARY_COLLECTION_ID) {
      return;
    }

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
  }, [appendActionLog, workspace.activeCollectionId, workspace.seriesDocs]);

  const canStagePrimaryDebugMove = workspace.activeCollectionId === PRIMARY_COLLECTION_ID;

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
    if (!activeManifestDoc) {
      return;
    }

    const doc = exportCollection({
      manifestDoc: activeManifestDoc,
      seriesDocsByDocName: workspace.seriesDocs,
    });
    setExportPreview(JSON.stringify(doc, null, 2));
  }, [activeManifestDoc, workspace.seriesDocs]);

  if (!activeManifestDoc || !activeSeriesDoc || !activeHierarchy || !currentFocusState) {
    return <div className="app-shell">No active series document loaded.</div>;
  }

  const manifestRoot = activeManifestDoc.content[0];
  const activeSeriesPresenceCount = collectionPresence[workspace.activeSeriesDocName] ?? 0;
  const linkedImages = focusedNode?.level === 'item' ? extractLinkedImages(focusedNode.fields) : [];
  const groupedItemFields = focusedNode?.level === 'item' ? groupItemFieldsForCms(focusedNode.fields) : [];
  const cmsLevelColor = focusedNode ? CMS_LEVEL_COLORS[focusedNode.level] : '#6b7280';
  const metadataByKey = focusedNode?.metadata ?? {};
  const activeCollectionTitle = String(manifestRoot.attrs?.title ?? 'Untitled Collection');
  const activeCollectionDescriptionText =
    activeCollectionDescription.length > 0 ? activeCollectionDescription : 'No collection description provided yet.';

  return (
    <div className="app-shell">
      <header className="workspace-header">
        <div className="workspace-header__brand">
          <div className="workspace-header__logo-stack">
            <img src={historiqLogo} alt="Historiq" className="workspace-header__logo" />
            <p className="workspace-header__kicker">Collaborative Editor</p>
          </div>

          <div className="workspace-header__meta">
            <div className="workspace-header__title-row">
              <div className="workspace-header__title-wrap">
                <h1 className="workspace-header__title-display" title={activeCollectionTitle}>
                  {activeCollectionTitle}
                </h1>
              </div>
            </div>
            <p className="workspace-header__sub">{activeCollectionDescriptionText}</p>
          </div>
        </div>

        <div className="header-actions">
          <p className="header-actions__institution">{activeInstitutionName}</p>
          <button type="button" className="header-user" title="Logged in user (placeholder)">
            <span className="header-user__avatar">{LOCAL_USER_INITIALS}</span>
          </button>

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
                <p className="browser-panel__hint">
                  Select a collection to review details, then open its hierarchy.
                </p>
                <label className="collection-search">
                  <span>Search Collections</span>
                  <input
                    type="search"
                    placeholder="Search by name, id, or description"
                    value={collectionSearch}
                    onChange={(event) => setCollectionSearch(event.target.value)}
                  />
                </label>
                <ul className="manifest-panel__series-list">
                  {filteredCollectionEntries.map((collection, index) => {
                    const isExpanded = expandedCollectionId === collection.collectionId;
                    return (
                      <li key={collection.collectionId}>
                        <div
                          className={
                            workspace.activeCollectionId === collection.collectionId
                              ? 'manifest-series manifest-series--active'
                              : 'manifest-series'
                          }
                        >
                          <div
                            className="manifest-series__open"
                            onClick={() => {
                              setActiveCollectionId(collection.collectionId);
                              setCollectionTitleMenuOpenId(null);
                              setExpandedCollectionId((current) =>
                                current === collection.collectionId ? null : collection.collectionId,
                              );
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setActiveCollectionId(collection.collectionId);
                                setCollectionTitleMenuOpenId(null);
                                setExpandedCollectionId((current) =>
                                  current === collection.collectionId ? null : collection.collectionId,
                                );
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <span className="manifest-series__order">{index + 1}</span>
                            <span className="manifest-series__body">
                              <div className="manifest-series__title-row">
                                {renamingCollectionId === collection.collectionId ? (
                                  <input
                                    type="text"
                                    className="manifest-series__title-input"
                                    value={collectionTitleDraft}
                                    autoFocus
                                    aria-label="Collection title"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        commitCollectionTitleRename(collection.collectionId);
                                      } else if (event.key === 'Escape') {
                                        event.preventDefault();
                                        cancelCollectionTitleRename();
                                      }
                                    }}
                                    onBlur={() => commitCollectionTitleRename(collection.collectionId)}
                                    onChange={(event) => setCollectionTitleDraft(event.target.value)}
                                  />
                                ) : (
                                  <span className="manifest-series__title-text" title={collection.title}>
                                    {collection.title}
                                  </span>
                                )}

                                <div className="title-menu title-menu--inline">
                                  <button
                                    type="button"
                                    className="title-menu__trigger title-menu__trigger--small"
                                    aria-label="Collection title actions"
                                    aria-expanded={collectionTitleMenuOpenId === collection.collectionId}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setCollectionTitleMenuOpenId((current) =>
                                        current === collection.collectionId ? null : collection.collectionId,
                                      );
                                    }}
                                  >
                                    <svg className="title-menu__icon" viewBox="0 0 24 24" aria-hidden="true">
                                      <circle cx="6" cy="12" r="1.9" fill="currentColor" />
                                      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
                                      <circle cx="18" cy="12" r="1.9" fill="currentColor" />
                                    </svg>
                                  </button>

                                  {collectionTitleMenuOpenId === collection.collectionId ? (
                                    <div
                                      className="title-menu__panel title-menu__panel--inline"
                                      role="menu"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="title-menu__item"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          beginCollectionTitleRename(collection.collectionId, collection.title);
                                        }}
                                      >
                                        Rename
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              {isExpanded ? (
                                <div className="manifest-series__meta-stack">
                                  <small>
                                    {collection.activeCount} active {collection.activeCount === 1 ? 'user' : 'users'}
                                  </small>
                                </div>
                              ) : null}
                            </span>
                          </div>

                          {isExpanded ? (
                            <div className="manifest-series__details">
                              <dl className="manifest-series__facts">
                                <div>
                                  <dt>Collection ID</dt>
                                  <dd>{collection.collectionId}</dd>
                                </div>
                                <div>
                                  <dt>Description</dt>
                                  <dd>{collection.description || 'No description provided.'}</dd>
                                </div>
                                <div>
                                  <dt>Series</dt>
                                  <dd>{collection.seriesRefs.length}</dd>
                                </div>
                              </dl>
                              <div className="manifest-series__details-actions">
                                <button
                                  type="button"
                                  className="manifest-series__explore"
                                  onClick={() => openCollectionFromBrowser(collection.collectionId)}
                                >
                                  Explore Hierarchy
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {filteredCollectionEntries.length === 0 ? (
                  <p className="manifest-panel__presence-note">No collections match your search.</p>
                ) : null}
                <p className="manifest-panel__presence-note">Collections loaded: {collectionEntries.length}</p>
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
                    <h2>{String(manifestRoot.attrs?.title ?? 'Guided Hierarchy')}</h2>
                    <p>
                      {String(manifestRoot.attrs?.dates ?? '')} · {seriesRefs.length} series
                    </p>
                  </div>
                </div>

                <p className="hierarchy-panel__hint">
                  Editing series: {activeSeriesRef?.title ?? workspace.activeSeriesDocName} ({activeSeriesPresenceCount}{' '}
                  active {activeSeriesPresenceCount === 1 ? 'user' : 'users'})
                </p>
                <FindingAidHierarchy
                  root={activeHierarchy}
                  focusState={currentFocusState}
                  seriesOptions={seriesRefs.map((series) => ({
                    docName: series.docName,
                    title: series.title,
                    presenceCount: collectionPresence[series.docName] ?? 0,
                  }))}
                  activeSeriesDocName={workspace.activeSeriesDocName}
                  onSelectSeries={openSeriesInHierarchy}
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
                  onMoveSeries={applyManifestSeriesMove}
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
          <div className="workspace-main__mode-row">
            <div className="mode-toggle" role="tablist" aria-label="Editor mode">
              <button
                type="button"
                data-mode="document"
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
                Finding Aid View
              </button>

              <button
                type="button"
                data-mode="focus"
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
                Catalog View
              </button>

              <button
                type="button"
                data-mode="json"
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
          </div>

          {currentFocusState.mode === 'document' ? (
            <section className="panel document-panel" aria-label="Finding Aid view">
              <FindingAidEditor
                content={seriesBodyNodes as PMNode[]}
                hierarchyHeadings={hierarchyHeadings}
                focusedHierarchyId={currentFocusState.focusedId ?? undefined}
                focusRequestKey={focusRequestKey}
                onCursorHierarchyFocus={focusHierarchyNodeFromDocument}
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
            <section className="panel focus-panel cms-panel" aria-label="Catalog view">
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
            <section className="panel json-panel" aria-label="JSON view">
              <p className="json-panel__hint">
                Source-of-truth data and transformed editor data used by the hierarchy, document, and Catalog screens.
              </p>

              <div className="json-panel__explain">
                <h3>How It Works</h3>
                <ol className="json-panel__explain-list">
                  <li>
                    Collection manifests are the source of truth for collection title, description, and ordered series refs.
                  </li>
                  <li>
                    Each series has its own canonical TipTap-compatible JSON document; hierarchy nodes and body sections live there.
                  </li>
                  <li>
                    The hierarchy widget edits node structure and metadata; those updates synchronize into both Finding Aid and Catalog views.
                  </li>
                  <li>
                    Finding Aid view renders a Word-style composite doc by combining canonical `seriesBody` with synthetic hierarchy headings.
                  </li>
                  <li>
                    Catalog view is generated from the currently focused hierarchy node and writes metadata straight back to canonical JSON.
                  </li>
                </ol>
              </div>

              <div className="json-panel__block">
                <h3>Workspace + Collections Manifest JSON (canonical collection state)</h3>
                <pre>{JSON.stringify(workspaceCollectionsJson, null, 2)}</pre>
              </div>

              <div className="json-panel__block">
                <h3>Active Focus State JSON</h3>
                <pre>{JSON.stringify(activeFocusStateJson, null, 2)}</pre>
              </div>

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
                <button type="button" onClick={() => openSeriesInHierarchy(SERIES_A_DOC_NAME)} disabled={!canStagePrimaryDebugMove}>
                  Open Series A
                </button>
                <button type="button" onClick={() => openSeriesInHierarchy(SERIES_B_DOC_NAME)} disabled={!canStagePrimaryDebugMove}>
                  Open Series B
                </button>
                <button type="button" onClick={stageCrossSeriesMoveProposal} disabled={!canStagePrimaryDebugMove}>
                  Stage Move A → B (file-a2)
                </button>
              </div>
              {!canStagePrimaryDebugMove ? (
                <p className="cross-series-playground__note">
                  Debug cross-series staging is seeded only for Railroad Company Records.
                </p>
              ) : null}
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
      <label className="field-input field-input--multiline">
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

function readCollectionDescription(manifest: CollectionManifestDoc): string {
  const root = manifest.content[0];
  const attrs = root.attrs ?? {};
  const descriptionValue = (attrs as Record<string, unknown>).description;

  if (typeof descriptionValue === 'string' && descriptionValue.trim().length > 0) {
    return descriptionValue.trim();
  }

  const metaNode = (root.content ?? []).find((node) => node.type === 'collectionMeta');
  if (!metaNode) {
    return '';
  }

  return readPlainText(metaNode).replace(/\s+/g, ' ').trim();
}

function readCollectionInstitution(manifest: CollectionManifestDoc): string {
  void manifest;
  return DEFAULT_INSTITUTION_NAME;
}

function readPlainText(node: PMNode): string {
  if (node.type === 'text') {
    return String((node as PMNode & { text?: string }).text ?? '');
  }

  if (!node.content || node.content.length === 0) {
    return '';
  }

  return node.content.map((entry) => readPlainText(entry as PMNode)).join(' ');
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

function createFocusStateForHierarchy(root: HierarchyNode): FocusState {
  const next = createInitialFocusState(root.id);
  next.expandedIds = collectHierarchyIds(root);
  return next;
}

function collectHierarchyIds(root: HierarchyNode): Set<string> {
  const ids = new Set<string>();

  const walk = (node: HierarchyNode) => {
    ids.add(node.id);
    for (const child of node.children) {
      walk(child);
    }
  };

  walk(root);
  return ids;
}

function createInitialWorkspace(): WorkspaceState {
  const primaryManifestDoc = structuredClone(manifestFixture) as CollectionManifestDoc;
  const secondaryManifestDoc = createSecondaryManifestStub();
  const sourceDoc = createSeriesAStub();
  let targetDoc = createSeriesBStub();
  const tertiaryDoc = createSeriesCStub();
  const quaternaryDoc = createSeriesDStub();
  const quinaryDoc = createSeriesEStub();
  const senaryDoc = createSeriesFStub();

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
  const seededQuinary = syncSeriesBodyWithHierarchy(quinaryDoc);
  const seededSenary = syncSeriesBodyWithHierarchy(senaryDoc);

  return {
    manifestsByCollectionId: {
      [PRIMARY_COLLECTION_ID]: primaryManifestDoc,
      [SECONDARY_COLLECTION_ID]: secondaryManifestDoc,
    },
    collectionOrder: [PRIMARY_COLLECTION_ID, SECONDARY_COLLECTION_ID],
    seriesDocs: {
      [SERIES_A_DOC_NAME]: seededSource,
      [SERIES_B_DOC_NAME]: seededTarget,
      [SERIES_C_DOC_NAME]: seededTertiary,
      [SERIES_D_DOC_NAME]: seededQuaternary,
      [SERIES_E_DOC_NAME]: seededQuinary,
      [SERIES_F_DOC_NAME]: seededSenary,
    },
    activeCollectionId: PRIMARY_COLLECTION_ID,
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

function createSecondaryManifestStub(): CollectionManifestDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'collectionManifest',
        attrs: {
          collectionId: SECONDARY_COLLECTION_ID,
          title: 'City Planning Department Records',
          dates: '1908-2005',
        },
        content: [
          {
            type: 'collectionMeta',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Municipal planning records covering zoning, redevelopment, and civic design initiatives.',
                  },
                ],
              },
            ],
          },
          {
            type: 'seriesRef',
            attrs: {
              seriesId: 'series-d',
              title: 'Policy and Governance Files',
              order: 1,
              docName: SERIES_D_DOC_NAME,
            },
          },
          {
            type: 'seriesRef',
            attrs: {
              seriesId: 'series-e',
              title: 'Neighborhood Survey Photography',
              order: 2,
              docName: SERIES_E_DOC_NAME,
            },
          },
          {
            type: 'seriesRef',
            attrs: {
              seriesId: 'series-f',
              title: 'Redevelopment Project Plans',
              order: 3,
              docName: SERIES_F_DOC_NAME,
            },
          },
        ],
      },
    ],
  };
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
          title: 'Policy and Governance Files',
          dates: '1912-1989',
          refCode: 'CPD-MS-001',
          extent: '9 linear feet',
          language: 'English',
          arrangement: 'By planning commission agenda item and ordinance sequence.',
          scopeContent: 'Administrative policy files, planning commission agendas, and adopted ordinances.',
          accessRestrictions: 'Open for research with limited redactions for personal data.',
          processingStatus: 'processed',
          digitalObjectUrl: 'https://example.org/collections/cpd/series-d',
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
                    text: 'Records documenting planning decisions, public hearings, and ordinance implementation.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-d1',
              title: 'Commission Minutes',
              dates: '1912-1968',
              refCode: 'CPD-MS-001.1',
              extent: '4 linear feet',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-d1-1', 'Planning Commission Minute Books', [
                createItemNode(
                  'item-gov-001',
                  'document',
                  'Bound minutes documenting zoning appeals and redevelopment votes.',
                  '1937-04-11',
                ),
              ]),
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-d2',
              title: 'Zoning Ordinances',
              dates: '1940-1989',
              refCode: 'CPD-MS-001.2',
              extent: '5 linear feet',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-d2-1', 'Adopted Ordinance Packets', [
                createItemNode(
                  'item-zone-001',
                  'document',
                  'Published ordinance packet with maps and implementation notes.',
                  '1974-02-20',
                ),
              ]),
            ],
          },
        ],
      },
    ],
  };
}

function createSeriesEStub(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: 'series-e',
          title: 'Neighborhood Survey Photography',
          dates: '1935-1998',
          refCode: 'CPD-MS-002',
          extent: '1,480 photographic prints and contact sheets',
          language: 'English',
          arrangement: 'By district and survey campaign.',
          scopeContent: 'Survey photography used to evaluate streets, housing stock, and civic infrastructure.',
          accessRestrictions: 'Some images restricted for privacy review.',
          processingStatus: 'in-progress',
          digitalObjectUrl: 'https://example.org/collections/cpd/series-e',
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
                    text: 'Photographic surveys capturing neighborhood conditions before redevelopment initiatives.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-e1',
              title: 'South District Survey',
              dates: '1958-1972',
              refCode: 'CPD-MS-002.1',
              extent: '620 prints',
              processingStatus: 'processed',
            },
            content: [
              createFileNode('file-e1-1', 'Residential Block Conditions', [
                createItemNode(
                  'item-survey-photo-001',
                  'photograph',
                  'Street-level survey image showing storefront occupancy and facade condition.',
                  '1961',
                ),
              ]),
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-e2',
              title: 'Downtown Streetscape',
              dates: '1970-1998',
              refCode: 'CPD-MS-002.2',
              extent: '860 prints',
              processingStatus: 'in-progress',
            },
            content: [
              createFileNode('file-e2-1', 'Transit Corridor Survey', [
                createItemNode(
                  'item-survey-photo-050',
                  'photograph',
                  'Aerial capture of transit corridor slated for redesign.',
                  '1988',
                ),
              ]),
            ],
          },
        ],
      },
    ],
  };
}

function createSeriesFStub(): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: 'series-f',
          title: 'Redevelopment Project Plans',
          dates: '1949-2005',
          refCode: 'CPD-MS-003',
          extent: '220 plan sets',
          language: 'English',
          arrangement: 'By project code and revision number.',
          scopeContent: 'Master plans, phased development documents, and site revision sets.',
          accessRestrictions: 'Open for use; oversized plans require handling support.',
          processingStatus: 'processed',
          digitalObjectUrl: 'https://example.org/collections/cpd/series-f',
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
                    text: 'Project plans and revisions for waterfront, transit, and mixed-use redevelopment projects.',
                  },
                ],
              },
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-f1',
              title: 'Waterfront Redevelopment',
              dates: '1949-1979',
              refCode: 'CPD-MS-003.1',
              extent: '98 plan sets',
              processingStatus: 'processed',
            },
            content: [
              createFileNode(
                'file-f1-1',
                'Phase I Site Plans',
                [createItemNode('item-plan-001', 'document', 'Annotated project plan showing parcel realignment and utilities.', '1956-08-03')],
                {
                  dates: '1955-1957',
                  refCode: 'CPD-MS-003.1.1',
                  extent: '16 sheets',
                },
              ),
            ],
          },
          {
            type: 'subseries',
            attrs: {
              id: 'subseries-f2',
              title: 'Transit Corridor Updates',
              dates: '1976-2005',
              refCode: 'CPD-MS-003.2',
              extent: '122 plan sets',
              processingStatus: 'processed',
            },
            content: [
              createFileNode(
                'file-f2-1',
                'Station Integration Plan',
                [createItemNode('item-plan-200', 'document', 'Revision package for station access and pedestrian routing.', '1996-10-14')],
                {
                  dates: '1995-1998',
                  refCode: 'CPD-MS-003.2.1',
                  extent: '28 sheets',
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
