import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from 'react';

import {
  InMemoryAgentActionLog,
  acceptMoveSubtreeCrossSeries,
  acceptSuggestionBlock,
  acceptSuggestionGroup,
  createPairedMoveProposals,
  evaluateMoveProposalStaleness,
  listBlockSuggestions,
  moveSeriesRef,
  rejectMoveSubtreeCrossSeries,
  rejectSuggestionBlock,
  rejectSuggestionGroup,
  manifestDocName,
  parseDocName,
  seriesDocName,
} from '../../../packages/core/src';
import type { AgentActionLogRecord, CollectionManifestDoc, PMNode, SeriesDoc } from '../../../src/contracts/types';
import manifestFixture from '../../../src/fixtures/manifest.doc.json';
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
  findHierarchyNode,
  readFocusedNode,
  setSeriesBodyNodes,
  syncSeriesBodyWithHierarchy,
  transferHierarchySectionsBetweenDocs,
  updateItemFieldValue,
  updateItemTitle,
  updateNodeMetadata,
  type FocusState,
  type HierarchyLevel,
  type HierarchyNode,
  type ItemFieldModel,
} from './lib/series';
import { formatHierarchyNodeHeading, getHierarchyLevelLabel, toRomanNumeral } from './lib/hierarchyLabels';
import { userInitials } from './lib/user';
import { CollabClient, buildCollabSeeds } from './lib/collab';
import type { AuthenticatedUser } from './types/auth';
import {
  fetchCollectionSeriesRefs,
  fetchHistorySnapshots,
  revertHistorySnapshot,
  type HistorySnapshot,
} from './lib/history';
import {
  connectOrgIndex,
  disconnectOrgIndex,
  getOrgIndexEntry,
  readOrgIndexEntries,
  upsertOrgIndexEntry,
} from './lib/canonicalIndex';
import type { OrgCollectionIndexEntry } from './lib/canonicalRooms';
import {
  fetchSharedCollectionSeriesRefs,
  fetchSharedCollectionEntries,
  patchSharedCollectionEntry,
  sharedCollectionsApiEnabled,
} from './lib/sharedCollectionsApi';
import {
  exportCollectionFindingAid,
  exportSeriesFindingAid,
  type ExportFormat,
} from './lib/findingAidExport';

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

type LocalUser = {
  id: string;
  name: string;
  color: string;
  avatar?: string;
};

type PresenceMap = Record<string, Array<{ id: string; name: string; color: string; avatar?: string }>>;
type CatalogCursorPresence = {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  position: number | null;
};
type CatalogCursorByField = Record<string, CatalogCursorPresence[]>;

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

function defaultCollabWsUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:1234';
  }

  const host = window.location.hostname;
  const port = window.location.port;
  const localDevHost = host === 'localhost' || host === '127.0.0.1';
  if (localDevHost && (port === '5173' || port === '4173' || port.length === 0)) {
    return 'ws://127.0.0.1:1234';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/collab/`;
}

function defaultCollabEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const query = new URLSearchParams(window.location.search).get('collab');
  if (query != null) {
    return query !== '0';
  }
  return true;
}

const COLLAB_WS_URL =
  (import.meta.env.VITE_HOCUS_URL as string | undefined) ??
  (import.meta.env.VITE_HOCUSPOCUS_URL as string | undefined) ??
  defaultCollabWsUrl();
const USER_COLOR_PALETTE = ['#ff5757', '#3b82f6', '#059669', '#a855f7', '#d97706', '#0f766e'];
const PLACEHOLDER_COLLECTION_META_TEXT = 'Synced from canonical org index. Series documents will load on demand.';
const PLACEHOLDER_SERIES_BODY_TEXT = 'Series content will sync here once loaded from the canonical room.';

function pickUserColor(seed: string): string {
  if (seed.length === 0) {
    return USER_COLOR_PALETTE[0];
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return USER_COLOR_PALETTE[hash % USER_COLOR_PALETTE.length] ?? USER_COLOR_PALETTE[0];
}

function displayNameForUser(user: AuthenticatedUser): string {
  const first = user.first_name?.trim() ?? '';
  const last = user.last_name?.trim() ?? '';
  const fullName = `${first} ${last}`.trim();
  if (fullName.length > 0) {
    return fullName;
  }
  return user.email;
}

const DEFAULT_INSTITUTION_NAME = 'Great Lakes Railroad Historical Society';

type AppProps = {
  currentUser: AuthenticatedUser;
  token: string;
  onLogout: () => void;
};

export function App({ currentUser, token, onLogout }: AppProps) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createInitialWorkspace());
  const [focusStateByDoc, setFocusStateByDoc] = useState<FocusStateMap>({});
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [pendingDocumentJump, setPendingDocumentJump] = useState<{ id: string; docName: string } | null>(null);
  const [railPanelMode, setRailPanelMode] = useState<RailPanelMode>('collections');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [showArchivedCollections, setShowArchivedCollections] = useState(false);
  const [showCollectionsWithoutSeries, setShowCollectionsWithoutSeries] = useState(false);
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(null);
  const [collectionTitleMenuOpenId, setCollectionTitleMenuOpenId] = useState<string | null>(null);
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [collectionTitleDraft, setCollectionTitleDraft] = useState('');
  const [seriesExportMenuOpen, setSeriesExportMenuOpen] = useState(false);
  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return new URLSearchParams(window.location.search).get('debug') === '1';
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [historyPanelCollapsed, setHistoryPanelCollapsed] = useState(true);
  const [historySnapshots, setHistorySnapshots] = useState<HistorySnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRevertingSnapshotId, setHistoryRevertingSnapshotId] = useState<number | null>(null);
  const [showNoSeriesMessage, setShowNoSeriesMessage] = useState(false);
  const [jsonViewDebugMode, setJsonViewDebugMode] = useState(false);
  const [logVersion, setLogVersion] = useState(0);
  const [presenceByNodeId, setPresenceByNodeId] = useState<PresenceMap>({});
  const [collectionPresence, setCollectionPresence] = useState<Record<string, number>>({});
  const [catalogCursorByField, setCatalogCursorByField] = useState<CatalogCursorByField>({});
  const [canonicalEntriesById, setCanonicalEntriesById] = useState<Record<string, OrgCollectionIndexEntry>>({});
  const canonicalEntriesRef = useRef<Record<string, OrgCollectionIndexEntry>>({});
  const canonicalMapRef = useRef<import('yjs').Map<string> | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [actionLogStore] = useState(() => new InMemoryAgentActionLog());
  const collabClientRef = useRef<CollabClient | null>(null);
  const collabInstanceIdRef = useRef<string>(`desktop-${crypto.randomUUID()}`);
  const lastFocusedSeriesDocRef = useRef<string | null>(null);
  const presenceSyncRafRef = useRef<number | null>(null);
  const manifestSeriesRecoveryAttemptedRef = useRef<Set<string>>(new Set());
  const localUser = useMemo(
    () => ({
      id: currentUser.id,
      name: displayNameForUser(currentUser),
      color: pickUserColor(currentUser.id),
      avatar: '',
    }),
    [currentUser],
  );
  const collabEnabled = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return defaultCollabEnabled();
  }, []);
  const sharedCollectionsEnabled = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return sharedCollectionsApiEnabled();
  }, []);
  const orgId = currentUser.organization_id ?? undefined;

  useEffect(() => {
    canonicalEntriesRef.current = canonicalEntriesById;
  }, [canonicalEntriesById]);

  useEffect(() => {
    manifestSeriesRecoveryAttemptedRef.current.clear();
  }, [collabEnabled, orgId, sharedCollectionsEnabled, token]);

  useEffect(() => {
    if (!orgId || !token) {
      setCanonicalEntriesById({});
      canonicalMapRef.current = null;
      return;
    }

    if (sharedCollectionsEnabled) {
      canonicalMapRef.current = null;
      let isDisposed = false;

      const refreshEntries = async () => {
        try {
          const next = await fetchSharedCollectionEntries();
          if (isDisposed) {
            return;
          }
          setCanonicalEntriesById(next);
        } catch (error) {
          if (!isDisposed) {
            console.error('Failed loading shared collection entries', error);
          }
        }
      };

      void refreshEntries();
      const intervalId = window.setInterval(() => {
        void refreshEntries();
      }, 20000);

      return () => {
        isDisposed = true;
        window.clearInterval(intervalId);
      };
    }

    const connection = connectOrgIndex(orgId, token);
    canonicalMapRef.current = connection.map;
    let isDisposed = false;

    const refreshEntries = () => {
      if (isDisposed) {
        return;
      }

      const entries = readOrgIndexEntries(connection.map);
      const next: Record<string, OrgCollectionIndexEntry> = {};
      for (const entry of entries) {
        next[entry.collectionId] = entry;
      }
      setCanonicalEntriesById(next);
    };

    connection.map.observe(refreshEntries);
    connection.provider.on('synced', refreshEntries);
    refreshEntries();

    return () => {
      isDisposed = true;
      connection.map.unobserve(refreshEntries);
      canonicalMapRef.current = null;
      disconnectOrgIndex(connection);
    };
  }, [orgId, sharedCollectionsEnabled, token]);

  const activeManifestDoc = useMemo(
    () => workspace.manifestsByCollectionId[workspace.activeCollectionId] ?? null,
    [workspace.activeCollectionId, workspace.manifestsByCollectionId],
  );
  const workspaceRef = useRef(workspace);
  const manualCollectionSelectionRef = useRef(false);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const manifestDocNameByCollectionId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const collectionId of workspace.collectionOrder) {
      map[collectionId] = orgId ? `collection:${orgId}:${collectionId}` : manifestDocName(collectionId);
    }
    return map;
  }, [orgId, workspace.collectionOrder]);

  const seriesRefs = useMemo(() => {
    if (!activeManifestDoc) {
      return [] as ManifestSeriesRef[];
    }
    const normalized = normalizeManifestSeriesRefsForOrg(activeManifestDoc, workspace.activeCollectionId, orgId).manifest;
    return readManifestSeriesRefs(normalized);
  }, [activeManifestDoc, orgId, workspace.activeCollectionId]);
  const historyDocName = workspace.activeSeriesDocName;

  useEffect(() => {
    if (!token || !historyDocName) {
      setHistorySnapshots([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    fetchHistorySnapshots({
      token,
      documentName: historyDocName,
      limit: 30,
    })
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setHistorySnapshots(rows);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error('Failed loading history snapshots', error);
        setHistoryError('Could not load history snapshots.');
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [historyDocName, token]);

  useEffect(() => {
    if (!token || !historyDocName) {
      return;
    }
    const hasPendingSnapshots = historySnapshots.some(
      (snapshot) => snapshot.diffStatus === 'pending' || snapshot.diffStatus === 'processing',
    );
    if (!hasPendingSnapshots) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchHistorySnapshots({
        token,
        documentName: historyDocName,
        limit: 30,
      })
        .then((rows) => {
          if (cancelled) {
            return;
          }
          setHistorySnapshots(rows);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error('Failed refreshing history snapshots', error);
        });
    }, 2200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [historyDocName, historySnapshots, token]);

  useEffect(() => {
    const canonicalIds = Object.keys(canonicalEntriesById);
    if (canonicalIds.length === 0) {
      return;
    }

    setWorkspace((previous) => {
      let hasChanges = false;
      const nextManifests = { ...previous.manifestsByCollectionId };
      const nextOrder = [...canonicalIds];

      for (const collectionId of previous.collectionOrder) {
        const canonical = canonicalEntriesById[collectionId];
        if (!canonical) {
          continue;
        }

        const manifest = previous.manifestsByCollectionId[collectionId];
        if (!manifest) {
          continue;
        }

        const currentTitle = String(manifest.content?.[0]?.attrs?.title ?? 'Untitled Collection');
        if (currentTitle === canonical.title) {
          continue;
        }

        const nextManifest = structuredClone(manifest);
        const root = nextManifest.content[0];
        root.attrs = {
          ...(root.attrs ?? {}),
          title: canonical.title,
        };
        nextManifests[collectionId] = nextManifest;
        hasChanges = true;
      }

      for (const collectionId of canonicalIds) {
        if (nextManifests[collectionId]) {
          continue;
        }

        const canonical = canonicalEntriesById[collectionId];
        if (!canonical) {
          continue;
        }

        nextManifests[collectionId] = createPlaceholderManifest(collectionId, canonical.title);
        hasChanges = true;
      }

      const canonicalOrder = nextOrder.sort((leftId, rightId) => {
        const left = canonicalEntriesById[leftId];
        const right = canonicalEntriesById[rightId];
        const leftTitle = left?.title ?? String(nextManifests[leftId]?.content?.[0]?.attrs?.title ?? leftId);
        const rightTitle = right?.title ?? String(nextManifests[rightId]?.content?.[0]?.attrs?.title ?? rightId);
        return leftTitle.localeCompare(rightTitle, undefined, { sensitivity: 'base' });
      });

      const orderChanged =
        canonicalOrder.length !== previous.collectionOrder.length ||
        canonicalOrder.some((collectionId, index) => collectionId !== previous.collectionOrder[index]);

      if (!hasChanges && !orderChanged) {
        return previous;
      }

      const nextActiveCollectionId = canonicalOrder.includes(previous.activeCollectionId)
        ? previous.activeCollectionId
        : (canonicalOrder.find((collectionId) => {
            const manifest = nextManifests[collectionId];
            return manifest ? readManifestSeriesRefs(manifest).length > 0 : false;
          }) ?? canonicalOrder[0] ?? previous.activeCollectionId);

      return {
        ...previous,
        activeCollectionId: nextActiveCollectionId,
        manifestsByCollectionId: hasChanges ? nextManifests : previous.manifestsByCollectionId,
        collectionOrder: orderChanged ? canonicalOrder : previous.collectionOrder,
      };
    });
  }, [canonicalEntriesById]);

  const collectionEntries = useMemo(() => {
    return workspace.collectionOrder
      .map((collectionId) => {
        const manifest = workspace.manifestsByCollectionId[collectionId];
        if (!manifest) {
          return null;
        }

        const root = manifest.content[0];
        const canonicalEntry = canonicalEntriesById[collectionId];
        const refs = readManifestSeriesRefs(manifest);
        const activeCount = refs.reduce((sum, ref) => sum + (collectionPresence[ref.docName] ?? 0), 0);
        return {
          collectionId,
          title: canonicalEntry?.title ?? String(root.attrs?.title ?? 'Untitled Collection'),
          description: readCollectionDescription(manifest),
          dates: String(root.attrs?.dates ?? ''),
          seriesRefs: refs,
          activeCount,
          workflowStatus: canonicalEntry?.workflowStatus ?? 'describe_started',
          submittedAt: canonicalEntry?.submittedAt ?? null,
          isArchived: Boolean(canonicalEntry?.isArchived),
        };
      })
      .filter((entry) => {
        if (!entry) {
          return false;
        }
        if (!showArchivedCollections && entry.isArchived) {
          return false;
        }
        if (!showCollectionsWithoutSeries && entry.seriesRefs.length === 0) {
          return false;
        }
        return true;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  }, [
    canonicalEntriesById,
    collectionPresence,
    showCollectionsWithoutSeries,
    showArchivedCollections,
    workspace.collectionOrder,
    workspace.manifestsByCollectionId,
  ]);

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
    () => seriesRefs.find((series) => series.docName === workspace.activeSeriesDocName) ?? seriesRefs[0] ?? null,
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

  useEffect(() => {
    setShowNoSeriesMessage(false);
    if (!activeManifestDoc || seriesRefs.length > 0 || typeof window === 'undefined') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowNoSeriesMessage(true);
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeManifestDoc, seriesRefs.length, workspace.activeCollectionId]);

  useEffect(() => {
    if (manualCollectionSelectionRef.current) {
      return;
    }

    const activeManifest = workspace.activeCollectionId
      ? workspace.manifestsByCollectionId[workspace.activeCollectionId]
      : null;
    if (activeManifest && readManifestSeriesRefs(activeManifest).length > 0) {
      return;
    }

    const fallbackCollectionId = workspace.collectionOrder.find((collectionId) => {
      const manifest = workspace.manifestsByCollectionId[collectionId];
      return manifest ? readManifestSeriesRefs(manifest).length > 0 : false;
    });
    if (!fallbackCollectionId || fallbackCollectionId === workspace.activeCollectionId) {
      return;
    }

    setWorkspace((previous) => {
      if (manualCollectionSelectionRef.current) {
        return previous;
      }

      const currentManifest = previous.activeCollectionId
        ? previous.manifestsByCollectionId[previous.activeCollectionId]
        : null;
      if (currentManifest && readManifestSeriesRefs(currentManifest).length > 0) {
        return previous;
      }

      const nextCollectionId = previous.collectionOrder.find((collectionId) => {
        const manifest = previous.manifestsByCollectionId[collectionId];
        return manifest ? readManifestSeriesRefs(manifest).length > 0 : false;
      });
      if (!nextCollectionId) {
        return previous;
      }

      const nextManifest = previous.manifestsByCollectionId[nextCollectionId];
      const nextSeriesDocName = nextManifest ? readManifestSeriesRefs(nextManifest)[0]?.docName ?? '' : '';
      return {
        ...previous,
        activeCollectionId: nextCollectionId,
        activeSeriesDocName: nextSeriesDocName || previous.activeSeriesDocName,
      };
    });
  }, [workspace.activeCollectionId, workspace.collectionOrder, workspace.manifestsByCollectionId]);

  const activeSeriesDoc = useMemo(() => {
    if (!activeSeriesRef) {
      return null;
    }
    const loaded = workspace.seriesDocs[activeSeriesRef.docName];
    if (loaded) {
      return loaded;
    }
    return createPlaceholderSeriesDoc(
      activeSeriesRef.seriesId || extractSeriesIdFromDocName(activeSeriesRef.docName),
      activeSeriesRef.title,
    );
  }, [activeSeriesRef, workspace.seriesDocs]);
  const activeSeriesProvider = collabEnabled
    ? activeSeriesRef
      ? collabClientRef.current?.getProvider(activeSeriesRef.docName) ?? null
      : null
    : null;

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
    if (!currentFocusState || jsonViewDebugMode || currentFocusState.mode !== 'json') {
      return;
    }

    updateCurrentFocusState((state) => ({
      ...state,
      mode: 'document',
      expandedIds: new Set(state.expandedIds),
    }));
  }, [currentFocusState, jsonViewDebugMode, updateCurrentFocusState]);

  const applyWorkspaceFromCollab = useCallback((changedDocName?: string) => {
    void changedDocName;
    const collab = collabClientRef.current;
    if (!collab) {
      return;
    }

    setWorkspace((previous) => {
      let nextManifests = previous.manifestsByCollectionId;
      let nextSeriesDocs = previous.seriesDocs;
      let nextActiveSeriesDocName = previous.activeSeriesDocName;
      let changed = false;
      const legacyToCanonicalDocNames: Record<string, string> = {};

      const targetCollectionIds = Array.from(
        new Set([...previous.collectionOrder, ...Object.keys(canonicalEntriesRef.current)]),
      );

      for (const collectionId of targetCollectionIds) {
        const sourceObjectId = canonicalEntriesRef.current[collectionId]?.sourceObjectId;
        const candidateRooms = manifestRoomCandidates({ collectionId, orgId, sourceObjectId });
        const candidateManifests = candidateRooms
          .map((docName) => collab.getDoc<CollectionManifestDoc>(docName))
          .filter((entry): entry is CollectionManifestDoc => entry != null);

        const remoteManifest =
          candidateManifests.find((entry) => !isPlaceholderManifestDoc(entry)) ?? candidateManifests[0] ?? null;

        if (!remoteManifest) {
          continue;
        }

        const normalizedRemote = normalizeManifestSeriesRefsForOrg(remoteManifest, collectionId, orgId);
        Object.assign(legacyToCanonicalDocNames, normalizedRemote.legacyToCanonicalDocNames);

        const currentManifest = previous.manifestsByCollectionId[collectionId];
        const shouldSkipPlaceholderOverride =
          currentManifest != null &&
          readManifestSeriesRefs(currentManifest).length > 0 &&
          isPlaceholderManifestDoc(normalizedRemote.manifest);
        if (!shouldSkipPlaceholderOverride && (!currentManifest || JSON.stringify(currentManifest) !== JSON.stringify(normalizedRemote.manifest))) {
          if (nextManifests === previous.manifestsByCollectionId) {
            nextManifests = { ...previous.manifestsByCollectionId };
          }
          nextManifests[collectionId] = normalizedRemote.manifest;
          changed = true;
        }
      }

      for (const collectionId of previous.collectionOrder) {
        const manifest = nextManifests[collectionId];
        if (!manifest) {
          continue;
        }

        const normalizedManifest = normalizeManifestSeriesRefsForOrg(manifest, collectionId, orgId);
        Object.assign(legacyToCanonicalDocNames, normalizedManifest.legacyToCanonicalDocNames);
        if (!normalizedManifest.changed) {
          continue;
        }

        if (nextManifests === previous.manifestsByCollectionId) {
          nextManifests = { ...previous.manifestsByCollectionId };
        }
        nextManifests[collectionId] = normalizedManifest.manifest;
        changed = true;
      }

      const canonicalToLegacyDocNames = new Map<string, string[]>();
      for (const [legacyDocName, canonicalDocName] of Object.entries(legacyToCanonicalDocNames)) {
        if (!legacyDocName || legacyDocName === canonicalDocName) {
          continue;
        }
        const aliases = canonicalToLegacyDocNames.get(canonicalDocName) ?? [];
        aliases.push(legacyDocName);
        canonicalToLegacyDocNames.set(canonicalDocName, aliases);
      }

      const manifestsForSeriesRefs =
        nextManifests === previous.manifestsByCollectionId ? previous.manifestsByCollectionId : nextManifests;

      for (const [collectionId, manifest] of Object.entries(manifestsForSeriesRefs)) {
        for (const ref of readManifestSeriesRefs(manifest)) {
          if (!ref.docName) {
            continue;
          }

          const legacyAliases = new Set<string>(canonicalToLegacyDocNames.get(ref.docName) ?? []);
          const legacyDefault = seriesDocName(
            collectionId,
            ref.seriesId || extractSeriesIdFromDocName(ref.docName),
          );
          if (legacyDefault && legacyDefault !== ref.docName) {
            legacyAliases.add(legacyDefault);
          }

          const primaryRemoteSeriesDoc = collab.getDoc<SeriesDoc>(ref.docName);
          let remoteSeriesDoc: SeriesDoc | null =
            primaryRemoteSeriesDoc && !isPlaceholderSeriesDoc(primaryRemoteSeriesDoc) ? primaryRemoteSeriesDoc : null;
          let placeholderFallbackSeriesDoc: SeriesDoc | null = primaryRemoteSeriesDoc ?? null;
          if (!remoteSeriesDoc) {
            for (const legacyDocName of legacyAliases) {
              const legacyDoc = collab.getDoc<SeriesDoc>(legacyDocName);
              if (!legacyDoc) {
                continue;
              }
              if (!isPlaceholderSeriesDoc(legacyDoc)) {
                remoteSeriesDoc = legacyDoc;
                break;
              }
              if (!placeholderFallbackSeriesDoc) {
                placeholderFallbackSeriesDoc = legacyDoc;
              }
            }
          }
          if (!remoteSeriesDoc) {
            remoteSeriesDoc = placeholderFallbackSeriesDoc;
          }

          let currentSeriesDoc = nextSeriesDocs[ref.docName];
          if (!currentSeriesDoc) {
            for (const legacyDocName of legacyAliases) {
              if (!nextSeriesDocs[legacyDocName]) {
                continue;
              }
              currentSeriesDoc = nextSeriesDocs[legacyDocName];
              break;
            }
          }

          if (remoteSeriesDoc && (!currentSeriesDoc || JSON.stringify(currentSeriesDoc) !== JSON.stringify(remoteSeriesDoc))) {
            if (nextSeriesDocs === previous.seriesDocs) {
              nextSeriesDocs = { ...previous.seriesDocs };
            }
            nextSeriesDocs[ref.docName] = remoteSeriesDoc;
            currentSeriesDoc = remoteSeriesDoc;
            changed = true;
          } else if (!currentSeriesDoc) {
            if (nextSeriesDocs === previous.seriesDocs) {
              nextSeriesDocs = { ...previous.seriesDocs };
            }
            nextSeriesDocs[ref.docName] = createPlaceholderSeriesDoc(
              ref.seriesId || extractSeriesIdFromDocName(ref.docName),
              ref.title,
            );
            currentSeriesDoc = nextSeriesDocs[ref.docName];
            changed = true;
          } else if (!nextSeriesDocs[ref.docName]) {
            if (nextSeriesDocs === previous.seriesDocs) {
              nextSeriesDocs = { ...previous.seriesDocs };
            }
            nextSeriesDocs[ref.docName] = currentSeriesDoc;
            changed = true;
          }

          for (const legacyDocName of legacyAliases) {
            if (legacyDocName === ref.docName) {
              continue;
            }
            if (!nextSeriesDocs[legacyDocName]) {
              continue;
            }
            if (nextSeriesDocs === previous.seriesDocs) {
              nextSeriesDocs = { ...previous.seriesDocs };
            }
            delete nextSeriesDocs[legacyDocName];
            if (nextActiveSeriesDocName === legacyDocName) {
              nextActiveSeriesDocName = ref.docName;
            }
            changed = true;
          }
        }
      }

      const mappedActiveDocName = legacyToCanonicalDocNames[nextActiveSeriesDocName];
      if (mappedActiveDocName && nextSeriesDocs[mappedActiveDocName] && mappedActiveDocName !== nextActiveSeriesDocName) {
        nextActiveSeriesDocName = mappedActiveDocName;
        changed = true;
      }

      if (!nextSeriesDocs[nextActiveSeriesDocName]) {
        const activeManifest = manifestsForSeriesRefs[previous.activeCollectionId];
        const fallbackDocName = activeManifest
          ? readManifestSeriesRefs(activeManifest).find((ref) => nextSeriesDocs[ref.docName])?.docName ?? null
          : null;
        if (fallbackDocName && fallbackDocName !== nextActiveSeriesDocName) {
          nextActiveSeriesDocName = fallbackDocName;
          changed = true;
        }
      }

      if (!changed) {
        return previous;
      }

      return {
        ...previous,
        manifestsByCollectionId: nextManifests,
        seriesDocs: nextSeriesDocs,
        activeSeriesDocName: nextActiveSeriesDocName,
      };
    });

  }, [orgId]);

  const refreshPresenceFromCollab = useCallback(() => {
    const collab = collabClientRef.current;
    if (!collab) {
      return;
    }

    const presenceByDoc = collab.getPresenceByDoc();
    const activeDocName = workspaceRef.current.activeSeriesDocName;
    const activeDocPresence = presenceByDoc[activeDocName] ?? [];
    const nextPresenceByNodeId: PresenceMap = {};
    const nextCollectionPresence: Record<string, number> = {};
    const nextCatalogCursorByField: CatalogCursorByField = {};

    for (const [docName, users] of Object.entries(presenceByDoc)) {
      if (docName.startsWith('series:')) {
        nextCollectionPresence[docName] = users.filter((entry) => entry.focusId != null).length;
      }
    }

    for (const state of activeDocPresence) {
      if (!state.focusId) {
        continue;
      }
      const chips = nextPresenceByNodeId[state.focusId] ?? [];
      chips.push(state.user);
      nextPresenceByNodeId[state.focusId] = chips;
    }

    for (const state of activeDocPresence) {
      if (state.isLocal || !state.catalogCursor?.fieldId) {
        continue;
      }

      const chips = nextCatalogCursorByField[state.catalogCursor.fieldId] ?? [];
      chips.push({
        id: state.user.id,
        name: state.user.name,
        color: state.user.color,
        avatar: state.user.avatar,
        position: state.catalogCursor.position,
      });
      nextCatalogCursorByField[state.catalogCursor.fieldId] = chips;
    }

    if (typeof window === 'undefined') {
      setPresenceByNodeId(nextPresenceByNodeId);
      setCollectionPresence(nextCollectionPresence);
      setCatalogCursorByField(nextCatalogCursorByField);
      return;
    }

    if (presenceSyncRafRef.current != null) {
      window.cancelAnimationFrame(presenceSyncRafRef.current);
    }
    presenceSyncRafRef.current = window.requestAnimationFrame(() => {
      presenceSyncRafRef.current = null;
      setPresenceByNodeId(nextPresenceByNodeId);
      setCollectionPresence(nextCollectionPresence);
      setCatalogCursorByField(nextCatalogCursorByField);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') {
        return;
      }
      if (presenceSyncRafRef.current != null) {
        window.cancelAnimationFrame(presenceSyncRafRef.current);
        presenceSyncRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!collabEnabled || !token) {
      return;
    }

    const collab = new CollabClient({
      url: COLLAB_WS_URL,
      user: localUser,
      instanceId: collabInstanceIdRef.current,
      authToken: token,
      onDocChanged: applyWorkspaceFromCollab,
      onPresenceChanged: refreshPresenceFromCollab,
    });
    collabClientRef.current = collab;

    const snapshot = workspaceRef.current;
    const seedMap: Record<string, string> = {};
    for (const collectionId of snapshot.collectionOrder) {
      seedMap[collectionId] = orgId ? `collection:${orgId}:${collectionId}` : manifestDocName(collectionId);
    }

    const seeds = buildCollabSeeds({
      manifestsByCollectionId: snapshot.manifestsByCollectionId,
      // When org scoping is available, canonical series rooms are connected below.
      // Avoid connecting legacy non-org room names to prevent split edit streams.
      seriesDocs: orgId ? {} : snapshot.seriesDocs,
      manifestDocNameByCollectionId: seedMap,
    });

    const canonicalSeriesSeeds = buildCanonicalSeriesSeeds({
      manifestsByCollectionId: snapshot.manifestsByCollectionId,
      seriesDocs: snapshot.seriesDocs,
      orgId,
    });
    const allSeeds = [...seeds];
    const connectedDocNames = new Set(allSeeds.map((seed) => seed.docName));
    for (const seed of canonicalSeriesSeeds) {
      if (connectedDocNames.has(seed.docName)) {
        continue;
      }
      allSeeds.push(seed);
      connectedDocNames.add(seed.docName);
    }
    for (const [collectionId, manifest] of Object.entries(snapshot.manifestsByCollectionId)) {
      const sourceObjectId = canonicalEntriesRef.current[collectionId]?.sourceObjectId;
      for (const docName of manifestRoomCandidates({ collectionId, orgId, sourceObjectId })) {
        if (connectedDocNames.has(docName)) {
          continue;
        }
        allSeeds.push({
          docName,
          initialValue: structuredClone(manifest),
        });
        connectedDocNames.add(docName);
      }
    }

    for (const seed of allSeeds) {
      collab.connectRoom(seed);
    }

    applyWorkspaceFromCollab();
    refreshPresenceFromCollab();

    return () => {
      collab.disconnectAll();
      collabClientRef.current = null;
    };
  }, [applyWorkspaceFromCollab, collabEnabled, localUser, orgId, refreshPresenceFromCollab, token]);

  useEffect(() => {
    if (!collabEnabled) {
      return;
    }

    const collab = collabClientRef.current;
    if (!collab) {
      return;
    }

    const seeds = buildCollabSeeds({
      manifestsByCollectionId: workspace.manifestsByCollectionId,
      // When org scoping is available, canonical series rooms are connected below.
      // Avoid connecting legacy non-org room names to prevent split edit streams.
      seriesDocs: orgId ? {} : workspace.seriesDocs,
      manifestDocNameByCollectionId,
    });

    const canonicalSeriesSeeds = buildCanonicalSeriesSeeds({
      manifestsByCollectionId: workspace.manifestsByCollectionId,
      seriesDocs: workspace.seriesDocs,
      orgId,
    });
    const allSeeds = [...seeds];
    const connectedDocNames = new Set(allSeeds.map((seed) => seed.docName));
    for (const seed of canonicalSeriesSeeds) {
      if (connectedDocNames.has(seed.docName)) {
        continue;
      }
      allSeeds.push(seed);
      connectedDocNames.add(seed.docName);
    }
    for (const [collectionId, manifest] of Object.entries(workspace.manifestsByCollectionId)) {
      const sourceObjectId = canonicalEntriesRef.current[collectionId]?.sourceObjectId;
      for (const docName of manifestRoomCandidates({ collectionId, orgId, sourceObjectId })) {
        if (connectedDocNames.has(docName)) {
          continue;
        }
        allSeeds.push({
          docName,
          initialValue: structuredClone(manifest),
        });
        connectedDocNames.add(docName);
      }
    }

    for (const seed of allSeeds) {
      collab.connectRoom(seed);
    }
  }, [collabEnabled, manifestDocNameByCollectionId, orgId, workspace.manifestsByCollectionId, workspace.seriesDocs]);

  useEffect(() => {
    if (!collabEnabled || !token) {
      return;
    }

    const pendingCollectionIds: string[] = [];
    for (const collectionId of workspace.collectionOrder) {
      const manifest = workspace.manifestsByCollectionId[collectionId];
      if (!manifest) {
        continue;
      }
      if (readManifestSeriesRefs(manifest).length > 0) {
        continue;
      }
      if (manifestSeriesRecoveryAttemptedRef.current.has(collectionId)) {
        continue;
      }
      manifestSeriesRecoveryAttemptedRef.current.add(collectionId);
      pendingCollectionIds.push(collectionId);
    }

    if (pendingCollectionIds.length === 0) {
      return;
    }

    let cancelled = false;
    for (const collectionId of pendingCollectionIds) {
      const sourceObjectId = canonicalEntriesRef.current[collectionId]?.sourceObjectId;
      const loadSeriesRefs = sharedCollectionsEnabled
        ? fetchSharedCollectionSeriesRefs({ collectionId, sourceObjectId })
        : fetchCollectionSeriesRefs({ token, collectionId, sourceObjectId });
      void loadSeriesRefs
        .then((refs) => {
          if (cancelled || refs.length === 0) {
            return;
          }
          const recoveredRefs = refs
            .map((ref) => ({
              seriesId: String(ref.seriesId ?? '').trim(),
              title: String(ref.title ?? 'Untitled Series'),
              order: Number.isFinite(ref.order) && ref.order > 0 ? Math.floor(ref.order) : 0,
              docName: String(ref.docName ?? '').trim(),
            }))
            .filter((ref) => ref.docName.length > 0);
          if (recoveredRefs.length === 0) {
            return;
          }

          setWorkspace((previous) => {
            const manifest = previous.manifestsByCollectionId[collectionId];
            if (!manifest) {
              return previous;
            }
            if (readManifestSeriesRefs(manifest).length > 0) {
              return previous;
            }

            const nextManifest = withManifestSeriesRefs(manifest, recoveredRefs);
            const nextManifests = {
              ...previous.manifestsByCollectionId,
              [collectionId]: nextManifest,
            };

            const nextActiveSeriesDocName =
              previous.activeCollectionId === collectionId && !previous.activeSeriesDocName
                ? recoveredRefs[0]?.docName ?? previous.activeSeriesDocName
                : previous.activeSeriesDocName;

            return {
              ...previous,
              manifestsByCollectionId: nextManifests,
              activeSeriesDocName: nextActiveSeriesDocName,
            };
          });
        })
        .catch((error) => {
          manifestSeriesRecoveryAttemptedRef.current.delete(collectionId);
          console.error(`Failed recovering series refs for collection ${collectionId}`, error);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [collabEnabled, sharedCollectionsEnabled, token, workspace.collectionOrder, workspace.manifestsByCollectionId]);

  useEffect(() => {
    if (!collabEnabled) {
      return;
    }

    const collab = collabClientRef.current;
    if (!collab) {
      return;
    }

    const seriesDocsToPublish = new Map<string, SeriesDoc>();

    for (const [collectionId, manifest] of Object.entries(workspace.manifestsByCollectionId)) {
      const roomName = manifestDocNameByCollectionId[collectionId];
      if (!roomName) {
        continue;
      }

      const normalizedManifest = normalizeManifestSeriesRefsForOrg(manifest, collectionId, orgId).manifest;
      if (!isPlaceholderManifestDoc(normalizedManifest)) {
        collab.publishDoc(roomName, normalizedManifest);
      }

      for (const ref of readManifestSeriesRefs(normalizedManifest)) {
        if (!ref.docName) {
          continue;
        }

        const fallbackLegacyDocName = seriesDocName(
          collectionId,
          ref.seriesId || extractSeriesIdFromDocName(ref.docName),
        );
        const sourceDoc =
          workspace.seriesDocs[ref.docName] ??
          workspace.seriesDocs[fallbackLegacyDocName] ??
          createPlaceholderSeriesDoc(ref.seriesId || extractSeriesIdFromDocName(ref.docName), ref.title);

        seriesDocsToPublish.set(ref.docName, sourceDoc);
      }
    }

    for (const [docName, seriesDoc] of seriesDocsToPublish.entries()) {
      if (isPlaceholderSeriesDoc(seriesDoc)) {
        continue;
      }
      collab.publishDoc(docName, seriesDoc);
    }
  }, [collabEnabled, manifestDocNameByCollectionId, orgId, workspace.manifestsByCollectionId, workspace.seriesDocs]);

  useEffect(() => {
    if (!currentFocusState) {
      return;
    }

    const collab = collabClientRef.current;
    if (collabEnabled && collab) {
      const previousDocName = lastFocusedSeriesDocRef.current;
      if (previousDocName && previousDocName !== workspace.activeSeriesDocName) {
        collab.setFocus(previousDocName, null);
        collab.setCatalogCursor(previousDocName, null);
      }
      collab.setFocus(workspace.activeSeriesDocName, currentFocusState.focusedId);
      lastFocusedSeriesDocRef.current = workspace.activeSeriesDocName;
      refreshPresenceFromCollab();
      return;
    }

    const focusedId = currentFocusState.focusedId;
    if (!focusedId) {
      setPresenceByNodeId({});
      return;
    }

    setPresenceByNodeId({
      [focusedId]: [localUser],
    });
  }, [collabEnabled, currentFocusState, localUser, refreshPresenceFromCollab, workspace.activeSeriesDocName]);

  useEffect(() => {
    if (collabEnabled && collabClientRef.current) {
      refreshPresenceFromCollab();
      return;
    }

    const counts: Record<string, number> = {};
    for (const docName of Object.keys(workspace.seriesDocs)) {
      counts[docName] = docName === workspace.activeSeriesDocName ? 1 : 0;
    }
    setCollectionPresence(counts);
    setCatalogCursorByField({});
  }, [collabEnabled, refreshPresenceFromCollab, workspace.activeSeriesDocName, workspace.seriesDocs]);

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

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !userMenuRef.current?.contains(target)) {
        setUserMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

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
    return flattenHierarchyHeadingsForDocument(activeHierarchy, activeSeriesRef?.order ?? 1);
  }, [activeHierarchy, activeSeriesRef?.order]);

  const hierarchyOrdinalById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const heading of hierarchyHeadings) {
      map[heading.id] = heading.pathLabel;
    }
    return map;
  }, [hierarchyHeadings]);

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

  const upsertCanonicalCollectionEntry = useCallback(
    (
      collectionId: string,
      patch: {
        title?: string;
        workflowStatus?: OrgCollectionIndexEntry['workflowStatus'];
        submittedAt?: string | null;
        isArchived?: boolean;
      },
    ) => {
      const nowIso = new Date().toISOString();
      const mergePatch = (existing?: OrgCollectionIndexEntry): OrgCollectionIndexEntry => ({
        collectionId,
        title: patch.title ?? existing?.title ?? collectionId,
        createdBy: existing?.createdBy ?? currentUser.id,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
        workflowStatus: patch.workflowStatus ?? existing?.workflowStatus ?? 'describe_started',
        submittedAt: patch.submittedAt ?? existing?.submittedAt ?? null,
        lastEditedBy: currentUser.id,
        isArchived: patch.isArchived ?? existing?.isArchived ?? false,
        sourceObjectId: existing?.sourceObjectId,
        entryType: existing?.entryType,
      });

      if (sharedCollectionsEnabled) {
        setCanonicalEntriesById((previous) => ({
          ...previous,
          [collectionId]: mergePatch(previous[collectionId]),
        }));

        void patchSharedCollectionEntry({ collectionId, patch })
          .then((updated) => {
            if (!updated) {
              return;
            }
            setCanonicalEntriesById((previous) => ({
              ...previous,
              [collectionId]: updated,
            }));
          })
          .catch((error) => {
            console.error(`Failed syncing collection metadata for ${collectionId}`, error);
          });
        return;
      }

      const map = canonicalMapRef.current;
      if (!map) {
        return;
      }

      const existing = getOrgIndexEntry(map, collectionId);
      upsertOrgIndexEntry(map, mergePatch(existing ?? undefined));
    },
    [currentUser.id, sharedCollectionsEnabled],
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
      upsertCanonicalCollectionEntry(collectionId, { title });
    },
    [updateCollectionManifest, upsertCanonicalCollectionEntry],
  );

  const setCollectionArchivedState = useCallback(
    (collectionId: string, isArchived: boolean) => {
      upsertCanonicalCollectionEntry(collectionId, {
        isArchived,
      });
    },
    [upsertCanonicalCollectionEntry],
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
        return {
          ...previous,
          activeCollectionId: collectionId,
          activeSeriesDocName: '',
        };
      }

      const refs = readManifestSeriesRefs(manifest);
      const nextActiveDocName =
        refs.find((ref) => ref.docName === previous.activeSeriesDocName)?.docName ?? refs[0]?.docName ?? null;

      if (!nextActiveDocName) {
        return {
          ...previous,
          activeCollectionId: collectionId,
          activeSeriesDocName: '',
        };
      }

      return {
        ...previous,
        activeCollectionId: collectionId,
        activeSeriesDocName: nextActiveDocName,
      };
    });
  }, []);

  const setActiveCollectionFromUser = useCallback(
    (collectionId: string) => {
      manualCollectionSelectionRef.current = true;
      setActiveCollectionId(collectionId);
    },
    [setActiveCollectionId],
  );

  const openCollectionFromBrowser = useCallback(
    (collectionId: string) => {
      setActiveCollectionFromUser(collectionId);
      setRailPanelMode('hierarchy');
    },
    [setActiveCollectionFromUser],
  );

  const beginCollectionTitleRename = useCallback(
    (collectionId: string, title: string) => {
      setCollectionTitleMenuOpenId(null);
      setRenamingCollectionId(collectionId);
      setCollectionTitleDraft(title);
      setActiveCollectionFromUser(collectionId);
    },
    [setActiveCollectionFromUser],
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
    },
    [updateCurrentFocusState],
  );

  const jumpToHierarchyNodeInDocument = useCallback(
    (id: string) => {
      updateCurrentFocusState((state) => ({
        ...state,
        focusedId: id,
        mode: 'document',
        expandedIds: new Set(state.expandedIds),
      }));
      setPendingDocumentJump({
        id,
        docName: workspace.activeSeriesDocName,
      });
    },
    [updateCurrentFocusState, workspace.activeSeriesDocName],
  );

  useEffect(() => {
    if (!pendingDocumentJump) {
      return;
    }

    if (pendingDocumentJump.docName !== workspace.activeSeriesDocName) {
      setPendingDocumentJump(null);
      return;
    }

    if (!currentFocusState) {
      return;
    }

    if (currentFocusState.mode !== 'document' || currentFocusState.focusedId !== pendingDocumentJump.id) {
      return;
    }

    setFocusRequestKey((value) => value + 1);
    setPendingDocumentJump(null);
  }, [currentFocusState, pendingDocumentJump, workspace.activeSeriesDocName]);

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

  const publishCatalogCursor = useCallback(
    (fieldId: string, position: number | null) => {
      const collab = collabClientRef.current;
      if (!collabEnabled || !collab) {
        return;
      }

      collab.setCatalogCursor(workspace.activeSeriesDocName, {
        fieldId,
        position,
      });
      refreshPresenceFromCollab();
    },
    [collabEnabled, refreshPresenceFromCollab, workspace.activeSeriesDocName],
  );

  const clearCatalogCursor = useCallback(() => {
    const collab = collabClientRef.current;
    if (!collabEnabled || !collab) {
      return;
    }

    collab.setCatalogCursor(workspace.activeSeriesDocName, null);
    refreshPresenceFromCollab();
  }, [collabEnabled, refreshPresenceFromCollab, workspace.activeSeriesDocName]);

  useEffect(() => {
    if (!collabEnabled || !currentFocusState || currentFocusState.mode === 'focus') {
      return;
    }

    clearCatalogCursor();
  }, [clearCatalogCursor, collabEnabled, currentFocusState]);

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

  const applyFindingAidHeadingTitleChange = useCallback(
    (nodeId: string, title: string) => {
      const normalized = title.trim();
      if (!activeHierarchy || normalized.length === 0) {
        return;
      }

      const node = findHierarchyNode(activeHierarchy, nodeId);
      if (!node) {
        return;
      }

      if (node.level === 'item') {
        updateActiveSeriesDoc((doc) => updateItemTitle(doc, nodeId, normalized));
        return;
      }

      updateActiveSeriesDoc((doc) => updateNodeMetadata(doc, nodeId, { title: normalized }));
    },
    [activeHierarchy, updateActiveSeriesDoc],
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
        userId: localUser.id,
        createdAt: Date.now(),
        docNames: [draggedDocName, targetDocName],
        suggestionIds: [],
        promptSummary: `MANUAL REORDER SERIES ${draggedDocName} ${placement} ${targetDocName}`,
        result: 'ok',
      });
    },
    [activeManifestDoc, appendActionLog, localUser.id],
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
        userId: localUser.id,
        createdAt: Date.now(),
        docNames,
        suggestionIds: [sid],
        groupId: target.groupId,
        promptSummary: `${decision.toUpperCase()} ${target.kind}`,
        result: status === 'applied' || status === 'noop' ? 'ok' : 'failed',
        errorMessage: reason,
      });
    },
    [appendActionLog, blockSuggestions, localUser.id, workspace],
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
        userId: localUser.id,
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
    [applyBlockSuggestionDecision, appendActionLog, blockSuggestions, localUser.id, workspace],
  );

  const applyManualHierarchyMove = useCallback(
    (draggedId: string, targetId: string, placement: 'before' | 'after') => {
      updateActiveSeriesDoc((doc) =>
        syncSeriesBodyWithHierarchy(moveSiblingHierarchyNode(doc, draggedId, targetId, placement)),
      );
      focusHierarchyNode(draggedId);

      appendActionLog({
        opId: crypto.randomUUID(),
        userId: localUser.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL REORDER ${draggedId} ${placement} ${targetId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, localUser.id, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyIndent = useCallback(
    (nodeId: string) => {
      updateActiveSeriesDoc((doc) => syncSeriesBodyWithHierarchy(indentHierarchyNode(doc, nodeId)));
      focusHierarchyNode(nodeId);
      appendActionLog({
        opId: crypto.randomUUID(),
        userId: localUser.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL INDENT ${nodeId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, localUser.id, updateActiveSeriesDoc, workspace.activeSeriesDocName],
  );

  const applyManualHierarchyOutdent = useCallback(
    (nodeId: string) => {
      updateActiveSeriesDoc((doc) => syncSeriesBodyWithHierarchy(outdentHierarchyNode(doc, nodeId)));
      focusHierarchyNode(nodeId);
      appendActionLog({
        opId: crypto.randomUUID(),
        userId: localUser.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL OUTDENT ${nodeId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, localUser.id, updateActiveSeriesDoc, workspace.activeSeriesDocName],
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
        userId: localUser.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL ADD ${level} under ${parentId}`,
        result: 'ok',
      });
    },
    [appendActionLog, focusHierarchyNode, localUser.id, updateActiveSeriesDoc, workspace.activeSeriesDocName],
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
        userId: localUser.id,
        createdAt: Date.now(),
        docNames: [workspace.activeSeriesDocName],
        suggestionIds: [],
        promptSummary: `MANUAL DELETE ${nodeId}`,
        result: 'ok',
      });
    },
    [activeHierarchy, appendActionLog, focusHierarchyNode, localUser.id, updateActiveSeriesDoc, workspace.activeSeriesDocName],
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
      author: localUser.id,
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
      userId: localUser.id,
      createdAt: Date.now(),
      docNames: [SERIES_A_DOC_NAME, SERIES_B_DOC_NAME],
      suggestionIds: [sid],
      promptSummary: 'DEBUG STAGE MOVE file-a2 -> subseries-b2',
      result: 'ok',
    });
  }, [appendActionLog, localUser.id, workspace.activeCollectionId, workspace.seriesDocs]);

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

  const runSeriesExport = useCallback(
    async (format: ExportFormat) => {
      if (!activeManifestDoc || !activeSeriesDoc) {
        return;
      }

      const manifestRoot = activeManifestDoc.content[0];
      const collectionTitle = String(manifestRoot.attrs?.title ?? 'Untitled Collection');
      const activeSeriesTitle = activeSeriesRef?.title ?? String(activeHierarchy?.title ?? 'Untitled Series');

      try {
        await exportSeriesFindingAid({
          format,
          input: {
            collectionId: String(manifestRoot.attrs?.collectionId ?? workspace.activeCollectionId),
            collectionTitle,
            institutionName: readCollectionInstitution(activeManifestDoc),
            collectionDescription: readCollectionDescription(activeManifestDoc),
            seriesId: activeSeriesRef?.seriesId ?? workspace.activeSeriesDocName,
            seriesTitle: activeSeriesTitle,
            seriesDoc: activeSeriesDoc,
          },
        });
        setSeriesExportMenuOpen(false);
      } catch (error) {
        console.error('Series export failed', error);
        window.alert('Series export failed. Check the console for details.');
      }
    },
    [
      activeHierarchy?.title,
      activeManifestDoc,
      activeSeriesDoc,
      activeSeriesRef?.seriesId,
      activeSeriesRef?.title,
      workspace.activeCollectionId,
      workspace.activeSeriesDocName,
    ],
  );

  const runCollectionExport = useCallback(
    async (collectionId: string, format: ExportFormat) => {
      const manifest = workspace.manifestsByCollectionId[collectionId];
      if (!manifest) {
        return;
      }

      const refs = readManifestSeriesRefs(manifest);
      const orderedSeries = refs
        .map((ref) => {
          const doc = workspace.seriesDocs[ref.docName];
          if (!doc) {
            return null;
          }
          return {
            seriesId: ref.seriesId,
            seriesTitle: ref.title,
            docName: ref.docName,
            seriesDoc: doc,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);

      if (orderedSeries.length === 0) {
        window.alert('No loaded series were found for this collection.');
        return;
      }

      const manifestRoot = manifest.content[0];
      const collectionTitle = String(manifestRoot.attrs?.title ?? 'Untitled Collection');

      try {
        await exportCollectionFindingAid({
          format,
          input: {
            collectionId: String(manifestRoot.attrs?.collectionId ?? collectionId),
            collectionTitle,
            institutionName: readCollectionInstitution(manifest),
            collectionDescription: readCollectionDescription(manifest),
            series: orderedSeries,
          },
        });
        setCollectionTitleMenuOpenId(null);
      } catch (error) {
        console.error('Collection export failed', error);
        window.alert('Collection export failed. Check the console for details.');
      }
    },
    [workspace.manifestsByCollectionId, workspace.seriesDocs],
  );

  const handleHistoryRevert = useCallback(
    async (snapshotId: number) => {
      if (!historyDocName || historyRevertingSnapshotId != null) {
        return;
      }
      setHistoryRevertingSnapshotId(snapshotId);
      setHistoryError(null);
      try {
        await revertHistorySnapshot({
          token,
          documentName: historyDocName,
          snapshotId,
        });
        const refreshed = await fetchHistorySnapshots({
          token,
          documentName: historyDocName,
          limit: 30,
        });
        setHistorySnapshots(refreshed);
        // Force a clean client doc bootstrap after server-side revert.
        window.setTimeout(() => {
          window.location.reload();
        }, 150);
      } catch (error) {
        console.error('Failed to revert snapshot', error);
        setHistoryError('Could not revert snapshot.');
      } finally {
        setHistoryRevertingSnapshotId(null);
      }
    },
    [historyDocName, historyRevertingSnapshotId, token],
  );

  if (!activeManifestDoc || !activeSeriesDoc || !activeHierarchy || !currentFocusState) {
    const bootstrappingCollections = collabEnabled && workspace.collectionOrder.length === 0;
    const bootstrappingSeries = Boolean(activeManifestDoc) && seriesRefs.length > 0 && !activeSeriesDoc;
    const noSeriesAvailable = Boolean(activeManifestDoc) && seriesRefs.length === 0;
    const showNoSeriesLoader = noSeriesAvailable && !showNoSeriesMessage;
    return (
      <div className="app-shell">
        {bootstrappingCollections || bootstrappingSeries
          ? 'Loading collection documents…'
          : showNoSeriesLoader
            ? 'Loading collection documents…'
            : noSeriesAvailable
            ? 'No series documents are available for this collection yet.'
            : 'No active series document loaded.'}
      </div>
    );
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
  const visibleMode = !jsonViewDebugMode && currentFocusState.mode === 'json' ? 'document' : currentFocusState.mode;
  const focusedNodeOrdinal = focusedNode ? hierarchyOrdinalById[focusedNode.id] ?? 'I' : 'I';
  const focusedCatalogHeading = focusedNode
    ? formatHierarchyNodeHeading(focusedNode.level, focusedNodeOrdinal, focusedNode.title)
    : '';

  return (
    <div className="app-shell">
      <header className="workspace-header">
        <div className="workspace-header__brand">
          <div className="workspace-header__logo-stack">
            <img src={historiqLogo} alt="Historiq" className="workspace-header__logo" />
            <p className="workspace-header__kicker">Una Collaborative Editor</p>
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
          <div className="header-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className={`header-user ${userMenuOpen ? 'header-user--active' : ''}`}
              title={localUser.name}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((value) => !value)}
            >
              <span className="header-user__avatar">
                {localUser.avatar ? (
                  <img src={localUser.avatar} alt={`${localUser.name} avatar`} className="header-user__avatar-image" />
                ) : (
                  userInitials(localUser.name)
                )}
              </span>
            </button>
            {userMenuOpen ? (
              <div className="header-menu" role="menu" aria-label="User menu">
                <div className="header-menu__identity">
                  <strong>{localUser.name}</strong>
                  <span>{currentUser.email}</span>
                </div>
                <div className="header-menu__row">
                  <span className="header-menu__label">Debug mode</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={jsonViewDebugMode}
                    title={`Debug mode ${jsonViewDebugMode ? 'on' : 'off'}`}
                    className={`debug-toggle__switch ${jsonViewDebugMode ? 'debug-toggle__switch--on' : ''}`}
                    onClick={() => setJsonViewDebugMode((value) => !value)}
                  >
                    <span className="debug-toggle__thumb" />
                  </button>
                </div>
                <button type="button" role="menuitem" className="header-menu__logout" onClick={onLogout}>
                  Log Out
                </button>
              </div>
            ) : null}
          </div>
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
                <label className="collection-filter-toggle">
                  <input
                    type="checkbox"
                    checked={showArchivedCollections}
                    onChange={(event) => setShowArchivedCollections(event.target.checked)}
                  />
                  <span>Show archived</span>
                </label>
                <label className="collection-filter-toggle">
                  <input
                    type="checkbox"
                    checked={showCollectionsWithoutSeries}
                    onChange={(event) => setShowCollectionsWithoutSeries(event.target.checked)}
                  />
                  <span>Show collections without series</span>
                </label>
                <ul className="manifest-panel__series-list">
                  {filteredCollectionEntries.map((collection, index) => {
                    const isExpanded = expandedCollectionId === collection.collectionId;
                    return (
                      <li key={collection.collectionId}>
                        <div
                          className={[
                            'manifest-series',
                            workspace.activeCollectionId === collection.collectionId ? 'manifest-series--active' : '',
                            collectionTitleMenuOpenId === collection.collectionId ? 'manifest-series--menu-open' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <div
                            className="manifest-series__open"
                            onClick={() => {
                              setActiveCollectionFromUser(collection.collectionId);
                              setCollectionTitleMenuOpenId(null);
                              setExpandedCollectionId((current) =>
                                current === collection.collectionId ? null : collection.collectionId,
                              );
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setActiveCollectionFromUser(collection.collectionId);
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
                                {collection.isArchived ? <small>Archived</small> : null}

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
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="title-menu__item"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setCollectionArchivedState(collection.collectionId, !collection.isArchived);
                                          setCollectionTitleMenuOpenId(null);
                                        }}
                                      >
                                        {collection.isArchived ? 'Unarchive' : 'Archive'}
                                      </button>
                                      <div className="title-menu__divider" />
                                      <p className="title-menu__group-label">Export</p>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="title-menu__item"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void runCollectionExport(collection.collectionId, 'word');
                                        }}
                                      >
                                        Export Word
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="title-menu__item"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void runCollectionExport(collection.collectionId, 'ead');
                                        }}
                                      >
                                        Export EAD XML
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="title-menu__item"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void runCollectionExport(collection.collectionId, 'html');
                                        }}
                                      >
                                        Export HTML
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="title-menu__item"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void runCollectionExport(collection.collectionId, 'pdf');
                                        }}
                                      >
                                        Export PDF
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

                <div className="hierarchy-panel__hint-row">
                  <p className="hierarchy-panel__hint">
                    Editing series: {activeSeriesRef?.title ?? workspace.activeSeriesDocName} ({activeSeriesPresenceCount}{' '}
                    active {activeSeriesPresenceCount === 1 ? 'user' : 'users'})
                  </p>
                  <div className="title-menu title-menu--inline">
                    <button
                      type="button"
                      className="title-menu__trigger title-menu__trigger--text"
                      aria-label="Export active series"
                      aria-expanded={seriesExportMenuOpen}
                      onClick={() => setSeriesExportMenuOpen((current) => !current)}
                    >
                      Export Series
                    </button>
                    {seriesExportMenuOpen ? (
                      <div className="title-menu__panel title-menu__panel--inline" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="title-menu__item"
                          onClick={() => void runSeriesExport('word')}
                        >
                          Export Word
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="title-menu__item"
                          onClick={() => void runSeriesExport('ead')}
                        >
                          Export EAD XML
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="title-menu__item"
                          onClick={() => void runSeriesExport('html')}
                        >
                          Export HTML
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="title-menu__item"
                          onClick={() => void runSeriesExport('pdf')}
                        >
                          Export PDF
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
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
                  onJumpToDocument={jumpToHierarchyNodeInDocument}
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
                aria-selected={visibleMode === 'document'}
                className={
                  visibleMode === 'document' ? 'mode-toggle__btn mode-toggle__btn--active' : 'mode-toggle__btn'
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
                aria-selected={visibleMode === 'focus'}
                className={
                  visibleMode === 'focus' ? 'mode-toggle__btn mode-toggle__btn--active' : 'mode-toggle__btn'
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

              {jsonViewDebugMode ? (
                <button
                  type="button"
                  data-mode="json"
                  role="tab"
                  aria-selected={visibleMode === 'json'}
                  className={visibleMode === 'json' ? 'mode-toggle__btn mode-toggle__btn--active' : 'mode-toggle__btn'}
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
              ) : null}
            </div>
          </div>

          {visibleMode === 'document' ? (
            <section className="panel document-panel" aria-label="Finding Aid view">
              <FindingAidEditor
                content={seriesBodyNodes as PMNode[]}
                hierarchyHeadings={hierarchyHeadings}
                focusedHierarchyId={currentFocusState.focusedId ?? undefined}
                focusRequestKey={focusRequestKey}
                onHierarchyTitleChange={applyFindingAidHeadingTitleChange}
                collaboration={
                  activeSeriesProvider
                    ? {
                        provider: activeSeriesProvider,
                        user: {
                          name: localUser.name,
                          color: localUser.color,
                          avatar: localUser.avatar,
                        },
                      }
                    : null
                }
                onCursorHierarchyFocus={focusHierarchyNodeFromDocument}
                onChange={(nextContent) => updateActiveSeriesDoc((doc) => setSeriesBodyNodes(doc, nextContent))}
              />
            </section>
          ) : visibleMode === 'focus' ? (
            <section className="panel focus-panel cms-panel" aria-label="Catalog view">
              <p className="cms-panel__hint">Plain forms generated from the focused hierarchy node.</p>

              {focusedNode ? (
                <div
                  className={`cms-shell cms-shell--${focusedNode.level}`}
                  style={{ '--cms-level-color': cmsLevelColor } as CSSProperties}
                >
                  <header className="cms-shell__header">
                    <div>
                      <span className="cms-shell__level">
                        {getHierarchyLevelLabel(focusedNode.level).toUpperCase()} {focusedNodeOrdinal}
                      </span>
                      <h3 className="cms-screen-title">{focusedCatalogHeading}</h3>
                      <p className="cms-screen-subtitle">Catalog Record</p>
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
                          <CatalogCollaborativeTextInput
                            id="title-editor"
                            className="title-editor"
                            fieldId={`${focusedNode.id}:title`}
                            presence={catalogCursorByField[`${focusedNode.id}:title`] ?? []}
                            value={focusedNode.title}
                            onCatalogCursor={publishCatalogCursor}
                            onCatalogBlur={clearCatalogCursor}
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
                                  fieldId={`${focusedNode.id}:meta:${field.key}`}
                                  presence={catalogCursorByField[`${focusedNode.id}:meta:${field.key}`] ?? []}
                                  label={field.label}
                                  value={metadataByKey[field.key] ?? ''}
                                  placeholder={field.placeholder}
                                  multiline={field.multiline}
                                  onCatalogCursor={publishCatalogCursor}
                                  onCatalogBlur={clearCatalogCursor}
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
                                    fieldId={`${focusedNode.id}:item:${field.fieldId}`}
                                    presence={catalogCursorByField[`${focusedNode.id}:item:${field.fieldId}`] ?? []}
                                    onCatalogCursor={publishCatalogCursor}
                                    onCatalogBlur={clearCatalogCursor}
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
        <aside className={historyPanelCollapsed ? 'workspace-context workspace-context--collapsed' : 'workspace-context'}>
          <section
            className={historyPanelCollapsed ? 'panel revisions-panel revisions-panel--collapsed' : 'panel revisions-panel'}
            aria-label="Series revision history"
          >
            {historyPanelCollapsed ? (
              <div className="workspace-context-actions">
                <button
                  type="button"
                  className="revisions-panel__collapsed-tab"
                  onClick={() => setHistoryPanelCollapsed(false)}
                  aria-label="Open revisions panel"
                  title="Open revisions"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 5.5a6.5 6.5 0 1 0 6.38 7.75 1 1 0 1 1 1.96.38A8.5 8.5 0 1 1 12 3.5h.25l-1.04-1.04a1 1 0 0 1 1.42-1.42l2.75 2.75a1 1 0 0 1 0 1.42l-2.75 2.75a1 1 0 1 1-1.42-1.42L12.25 5.5H12Z"
                      fill="currentColor"
                    />
                    <path
                      d="M12 7.75a1 1 0 0 1 1 1v2.62l1.88 1.13a1 1 0 0 1-1.03 1.72l-2.37-1.42a1 1 0 0 1-.48-.86V8.75a1 1 0 0 1 1-1Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>

                <div className="export-flyout">
                  <button type="button" className="revisions-panel__collapsed-tab" aria-label="Export options" title="Export options">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 3.98a1 1 0 0 1-1.4 0l-4-3.98a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1ZM5 18a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>

                  <div className="export-flyout__panel" role="menu" aria-label="Export finding aid">
                    <div className="export-flyout__group">
                      <div className="export-flyout__item">Entire Collection</div>
                      <div className="export-flyout__submenu">
                        <button type="button" onClick={() => void runCollectionExport(workspace.activeCollectionId, 'word')}>
                          DOCX
                        </button>
                        <button type="button" onClick={() => void runCollectionExport(workspace.activeCollectionId, 'ead')}>
                          EAD XML
                        </button>
                        <button type="button" onClick={() => void runCollectionExport(workspace.activeCollectionId, 'html')}>
                          HTML
                        </button>
                        <button type="button" onClick={() => void runCollectionExport(workspace.activeCollectionId, 'pdf')}>
                          PDF
                        </button>
                      </div>
                    </div>

                    <div className="export-flyout__group">
                      <div className="export-flyout__item">Active Series</div>
                      <div className="export-flyout__submenu">
                        <button type="button" onClick={() => void runSeriesExport('word')}>
                          DOCX
                        </button>
                        <button type="button" onClick={() => void runSeriesExport('ead')}>
                          EAD XML
                        </button>
                        <button type="button" onClick={() => void runSeriesExport('html')}>
                          HTML
                        </button>
                        <button type="button" onClick={() => void runSeriesExport('pdf')}>
                          PDF
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="revisions-panel__header">
                  <div className="revisions-panel__heading">
                    <h3>Revisions</h3>
                    <p>{activeSeriesRef?.title ?? historyDocName}</p>
                  </div>
                  <button
                    type="button"
                    className="revisions-panel__toggle"
                    onClick={() => setHistoryPanelCollapsed(true)}
                    aria-label="Collapse revisions panel"
                    title="Collapse"
                  >
                    ▶
                  </button>
                </div>

                {historyLoading ? <p className="revisions-panel__status">Loading revisions…</p> : null}
                {historyError ? <p className="revisions-panel__error">{historyError}</p> : null}
                {!historyLoading && historySnapshots.length === 0 ? (
                  <p className="revisions-panel__status">No revisions yet for this finding aid.</p>
                ) : null}
                {!historyLoading && historySnapshots.length > 0 ? (
                  <ul className="revisions-panel__list">
                    {historySnapshots.map((snapshot) => (
                      <li key={snapshot.id} className="revisions-panel__item">
                        <span className="revisions-panel__id">rev {snapshot.id}</span>
                        {snapshot.revertedFromSnapshotId != null ? (
                          <span className="revisions-panel__reverted-tag">reverted from rev {snapshot.revertedFromSnapshotId}</span>
                        ) : null}
                        <div className="revisions-panel__item-top">
                          <strong className="revisions-panel__date">{new Date(snapshot.createdAt).toLocaleString()}</strong>
                          <button
                            type="button"
                            className="revisions-panel__revert"
                            disabled={historyRevertingSnapshotId != null}
                            onClick={() => handleHistoryRevert(snapshot.id)}
                          >
                            {historyRevertingSnapshotId === snapshot.id ? 'Reverting…' : 'Revert'}
                          </button>
                        </div>
                        <div className="revisions-panel__changes">{renderRevisionSummaryMarkdown(snapshot.summary ?? '', snapshot.diffStatus)}</div>
                        {snapshot.diffStatus === 'failed' && snapshot.diffError ? (
                          <small className="revisions-panel__diff-error">{snapshot.diffError}</small>
                        ) : null}
                        <small className="revisions-panel__meta">
                          {snapshot.actorType ?? 'human'}
                          {snapshot.actorId ? ` · ${snapshot.actorId}` : ''}
                          {snapshot.source ? ` · ${snapshot.source}` : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`md-bold-${index}`} className="revisions-panel__md-strong">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={`md-code-${index}`} className="revisions-panel__md-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`md-text-${index}`}>{part}</span>;
  });
}

function renderRevisionSummaryMarkdown(summary: string, diffStatus: 'pending' | 'processing' | 'done' | 'failed' | null): ReactNode {
  if (diffStatus === 'pending' || diffStatus === 'processing') {
    return <p className="revisions-panel__changes-paragraph">Analyzing revision changes…</p>;
  }

  const normalized = summary.trim();
  if (!normalized) {
    return (
      <ul className="revisions-panel__changes-list">
        <li>
          <strong className="revisions-panel__md-strong">Finding Aid:</strong> Updated finding aid content.
        </li>
        <li>
          <strong className="revisions-panel__md-strong">Catalog:</strong> No direct catalog field changes detected.
        </li>
      </ul>
    );
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bulletLines = lines.filter((line) => line.startsWith('- '));
  if (bulletLines.length > 0) {
    return (
      <ul className="revisions-panel__changes-list">
        {bulletLines.map((line, index) => (
          <li key={`summary-bullet-${index}`}>{renderInlineMarkdown(line.slice(2))}</li>
        ))}
      </ul>
    );
  }

  return <p className="revisions-panel__changes-paragraph">{renderInlineMarkdown(normalized)}</p>;
}

type FieldInputProps = {
  field: ItemFieldModel;
  fieldId: string;
  presence: CatalogCursorPresence[];
  onCatalogCursor: (fieldId: string, position: number | null) => void;
  onCatalogBlur: () => void;
  onChange: (value: string | number | boolean | null) => void;
};

function FieldInput({ field, fieldId, presence, onCatalogCursor, onCatalogBlur, onChange }: FieldInputProps) {
  const selectOptions = getSelectOptions(field);
  const label = field.groupKey ? `${field.groupKey}.${field.key}` : field.key;

  if (field.valueType === 'boolean') {
    return (
      <label className="field-input field-input--boolean">
        <span className="field-input__label-row">
          <span>{label}</span>
          <CatalogPresenceBadges presence={presence} />
        </span>
        <input
          type="checkbox"
          checked={Boolean(field.value)}
          onFocus={() => onCatalogCursor(fieldId, null)}
          onBlur={onCatalogBlur}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }

  if (field.valueType === 'number') {
    return (
      <label className="field-input">
        <span className="field-input__label-row">
          <span>{label}</span>
          <CatalogPresenceBadges presence={presence} />
        </span>
        <CatalogCollaborativeTextInput
          type="number"
          fieldId={fieldId}
          presence={presence}
          value={field.value == null ? '' : String(field.value)}
          onCatalogCursor={onCatalogCursor}
          onCatalogBlur={onCatalogBlur}
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
        <span className="field-input__label-row">
          <span>{label}</span>
          <CatalogPresenceBadges presence={presence} />
        </span>
        <select
          value={String(field.value ?? '')}
          onFocus={() => onCatalogCursor(fieldId, null)}
          onBlur={onCatalogBlur}
          onChange={(event) => onChange(event.target.value)}
        >
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
      <span className="field-input__label-row">
        <span>{label}</span>
        <CatalogPresenceBadges presence={presence} />
      </span>
      <CatalogCollaborativeTextInput
        type="text"
        fieldId={fieldId}
        presence={presence}
        value={field.value == null ? '' : String(field.value)}
        onCatalogCursor={onCatalogCursor}
        onCatalogBlur={onCatalogBlur}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type CmsMetadataInputProps = {
  fieldId: string;
  presence: CatalogCursorPresence[];
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onCatalogCursor: (fieldId: string, position: number | null) => void;
  onCatalogBlur: () => void;
  onChange: (value: string) => void;
};

function CmsMetadataInput({
  fieldId,
  presence,
  label,
  value,
  placeholder,
  multiline,
  onCatalogCursor,
  onCatalogBlur,
  onChange,
}: CmsMetadataInputProps) {
  if (multiline) {
    return (
      <label className="field-input field-input--multiline">
        <span className="field-input__label-row">
          <span>{label}</span>
          <CatalogPresenceBadges presence={presence} />
        </span>
        <CatalogCollaborativeTextarea
          fieldId={fieldId}
          presence={presence}
          value={value}
          placeholder={placeholder}
          onCatalogCursor={onCatalogCursor}
          onCatalogBlur={onCatalogBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="field-input">
      <span className="field-input__label-row">
        <span>{label}</span>
        <CatalogPresenceBadges presence={presence} />
      </span>
      <CatalogCollaborativeTextInput
        type="text"
        fieldId={fieldId}
        presence={presence}
        value={value}
        placeholder={placeholder}
        onCatalogCursor={onCatalogCursor}
        onCatalogBlur={onCatalogBlur}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type CatalogCollaborativeInputProps = {
  id?: string;
  className?: string;
  type?: 'text' | 'number';
  fieldId: string;
  value: string;
  placeholder?: string;
  presence: CatalogCursorPresence[];
  onCatalogCursor: (fieldId: string, position: number | null) => void;
  onCatalogBlur: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

function CatalogCollaborativeTextInput({
  id,
  className,
  type = 'text',
  fieldId,
  value,
  placeholder,
  presence,
  onCatalogCursor,
  onCatalogBlur,
  onChange,
}: CatalogCollaborativeInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const carets = useMemo(() => {
    const element = inputRef.current;
    if (!element || presence.length === 0) {
      return [] as Array<CatalogCursorPresence & { left: number }>;
    }

    return presence.map((entry) => ({
      ...entry,
      left: computeInputCaretLeft(element, value, entry.position),
    }));
  }, [presence, value]);

  const reportCursor = useCallback(
    (target: HTMLInputElement) => {
      const rawPosition = target.selectionStart;
      const position = typeof rawPosition === 'number' ? rawPosition : target.value.length;
      onCatalogCursor(fieldId, position);
    },
    [fieldId, onCatalogCursor],
  );

  return (
    <div className="catalog-cursor-field">
      <input
        ref={inputRef}
        id={id}
        className={className}
        type={type}
        value={value}
        placeholder={placeholder}
        onFocus={(event) => reportCursor(event.currentTarget)}
        onInput={(event) => reportCursor(event.currentTarget)}
        onKeyUp={(event) => reportCursor(event.currentTarget)}
        onClick={(event) => reportCursor(event.currentTarget)}
        onSelect={(event) => reportCursor(event.currentTarget)}
        onBlur={onCatalogBlur}
        onChange={onChange}
      />
      {carets.length > 0 ? (
        <div className="catalog-cursor-field__overlay" aria-hidden="true">
          {carets.map((entry) => (
            <span
              key={entry.id}
              className="catalog-cursor-field__caret"
              style={{ left: `${entry.left}px`, color: entry.color }}
              title={`${entry.name} editing`}
            >
              <span
                className={
                  entry.avatar
                    ? 'catalog-cursor-field__caret-label catalog-cursor-field__caret-label--avatar'
                    : 'catalog-cursor-field__caret-label'
                }
              >
                {entry.avatar ? (
                  <img
                    src={entry.avatar}
                    alt={`${entry.name} avatar`}
                    className="catalog-cursor-field__caret-avatar"
                  />
                ) : (
                  userInitials(entry.name)
                )}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type CatalogCollaborativeTextareaProps = {
  fieldId: string;
  value: string;
  placeholder?: string;
  presence: CatalogCursorPresence[];
  onCatalogCursor: (fieldId: string, position: number | null) => void;
  onCatalogBlur: () => void;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

function CatalogCollaborativeTextarea({
  fieldId,
  value,
  placeholder,
  presence,
  onCatalogCursor,
  onCatalogBlur,
  onChange,
}: CatalogCollaborativeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const carets = useMemo(() => {
    const element = textareaRef.current;
    if (!element || presence.length === 0) {
      return [] as Array<CatalogCursorPresence & { left: number; top: number }>;
    }

    return presence.map((entry) => ({
      ...entry,
      ...computeTextareaCaretPosition(element, value, entry.position),
    }));
  }, [presence, value]);

  const reportCursor = useCallback(
    (target: HTMLTextAreaElement) => {
      const rawPosition = target.selectionStart;
      const position = typeof rawPosition === 'number' ? rawPosition : target.value.length;
      onCatalogCursor(fieldId, position);
    },
    [fieldId, onCatalogCursor],
  );

  return (
    <div className="catalog-cursor-field catalog-cursor-field--textarea">
      <textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        onFocus={(event) => reportCursor(event.currentTarget)}
        onInput={(event) => reportCursor(event.currentTarget)}
        onKeyUp={(event) => reportCursor(event.currentTarget)}
        onClick={(event) => reportCursor(event.currentTarget)}
        onSelect={(event) => reportCursor(event.currentTarget)}
        onBlur={onCatalogBlur}
        onChange={onChange}
      />
      {carets.length > 0 ? (
        <div className="catalog-cursor-field__overlay" aria-hidden="true">
          {carets.map((entry) => (
            <span
              key={`${entry.id}-${entry.position ?? 'null'}`}
              className="catalog-cursor-field__caret catalog-cursor-field__caret--textarea"
              style={{ left: `${entry.left}px`, top: `${entry.top}px`, color: entry.color }}
              title={`${entry.name} editing`}
            >
              <span
                className={
                  entry.avatar
                    ? 'catalog-cursor-field__caret-label catalog-cursor-field__caret-label--avatar'
                    : 'catalog-cursor-field__caret-label'
                }
              >
                {entry.avatar ? (
                  <img
                    src={entry.avatar}
                    alt={`${entry.name} avatar`}
                    className="catalog-cursor-field__caret-avatar"
                  />
                ) : (
                  userInitials(entry.name)
                )}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      <CatalogPresenceBadges presence={presence} />
    </div>
  );
}

function CatalogPresenceBadges({ presence }: { presence: CatalogCursorPresence[] }) {
  if (presence.length === 0) {
    return null;
  }

  return (
    <span className="catalog-presence-badges">
      {presence.slice(0, 3).map((entry) => (
        <span
          key={entry.id}
          className={
            entry.avatar
              ? 'catalog-presence-badges__chip catalog-presence-badges__chip--avatar'
              : 'catalog-presence-badges__chip'
          }
          style={{
            backgroundColor: entry.avatar ? '#ffffff' : entry.color,
            borderColor: entry.color,
          }}
          title={`${entry.name} editing this field`}
        >
          {entry.avatar ? (
            <img src={entry.avatar} alt={`${entry.name} avatar`} className="catalog-presence-badges__avatar" />
          ) : (
            userInitials(entry.name)
          )}
        </span>
      ))}
    </span>
  );
}

function computeInputCaretLeft(element: HTMLInputElement, value: string, position: number | null): number {
  const computed = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
  const maxLeft = Math.max(paddingLeft, element.clientWidth - paddingRight);
  const length = value.length;
  const cursorIndex = Math.max(0, Math.min(typeof position === 'number' ? position : length, length));
  const textBeforeCursor = value.slice(0, cursorIndex);
  const measuredText = measureTextWidth(computed, textBeforeCursor);
  const rawLeft = paddingLeft + measuredText - element.scrollLeft;
  return Math.max(paddingLeft, Math.min(rawLeft, maxLeft));
}

function computeTextareaCaretPosition(
  element: HTMLTextAreaElement,
  value: string,
  position: number | null,
): { left: number; top: number } {
  const computed = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const lineHeight = Number.parseFloat(computed.lineHeight) || 16;
  const length = value.length;
  const cursorIndex = Math.max(0, Math.min(typeof position === 'number' ? position : length, length));

  if (typeof document === 'undefined') {
    return { left: paddingLeft, top: paddingTop };
  }

  const mirror = document.createElement('div');
  const style = mirror.style;
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.pointerEvents = 'none';
  style.left = '-9999px';
  style.top = '0';
  style.width = `${element.clientWidth}px`;
  style.boxSizing = computed.boxSizing;
  style.border = computed.border;
  style.padding = computed.padding;
  style.fontFamily = computed.fontFamily;
  style.fontSize = computed.fontSize;
  style.fontWeight = computed.fontWeight;
  style.fontStyle = computed.fontStyle;
  style.letterSpacing = computed.letterSpacing;
  style.lineHeight = computed.lineHeight;
  style.textTransform = computed.textTransform;
  style.textIndent = computed.textIndent;
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  style.wordBreak = 'break-word';

  const beforeCursor = value.slice(0, cursorIndex);
  mirror.textContent = beforeCursor;
  if (beforeCursor.endsWith('\n')) {
    mirror.textContent += '\u200b';
  }

  const marker = document.createElement('span');
  marker.textContent = value.slice(cursorIndex) || '\u200b';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const rawLeft = marker.offsetLeft - element.scrollLeft;
  const rawTop = marker.offsetTop - element.scrollTop;
  document.body.removeChild(mirror);

  const maxLeft = Math.max(paddingLeft, element.clientWidth - paddingRight);
  return {
    left: Math.max(paddingLeft, Math.min(rawLeft, maxLeft)),
    top: Math.max(paddingTop, rawTop + lineHeight * 0.1),
  };
}

let cachedTextMeasureContext: CanvasRenderingContext2D | null = null;

function measureTextWidth(computed: CSSStyleDeclaration, text: string): number {
  if (typeof document === 'undefined') {
    return text.length * 7;
  }

  if (!cachedTextMeasureContext) {
    const canvas = document.createElement('canvas');
    cachedTextMeasureContext = canvas.getContext('2d');
  }

  if (!cachedTextMeasureContext) {
    return text.length * 7;
  }

  const fontSize = computed.fontSize || '14px';
  const fontFamily = computed.fontFamily || 'sans-serif';
  const fontWeight = computed.fontWeight || '400';
  const fontStyle = computed.fontStyle || 'normal';
  cachedTextMeasureContext.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
  return cachedTextMeasureContext.measureText(text).width;
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

function deriveSeriesId(attrs: Record<string, unknown>, fallbackDocName: string, fallbackIndex: number): string {
  const rawSeriesId = String(attrs.seriesId ?? '').trim();
  if (rawSeriesId.length > 0) {
    return rawSeriesId;
  }

  const parsed = parseDocName(fallbackDocName);
  if (parsed?.kind === 'series' && parsed.seriesId) {
    return parsed.seriesId;
  }

  const extracted = extractSeriesIdFromDocName(fallbackDocName);
  if (extracted.length > 0) {
    return extracted;
  }

  return `series-${fallbackIndex + 1}`;
}

function canonicalSeriesDocNameForRef(args: {
  collectionId: string;
  seriesId: string;
  docName: string;
  orgId?: string;
}): string {
  if (!args.orgId) {
    if (args.docName.trim().length > 0) {
      return args.docName;
    }
    return seriesDocName(args.collectionId, args.seriesId);
  }

  return seriesDocName(args.collectionId, args.seriesId, args.orgId);
}

function manifestRoomCandidates(args: {
  collectionId: string;
  orgId?: string;
  sourceObjectId?: string;
}): string[] {
  const ids: string[] = [];
  const pushId = (value?: string) => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || ids.includes(trimmed)) {
      return;
    }
    ids.push(trimmed);
  };

  pushId(args.collectionId);
  pushId(args.sourceObjectId);

  const rooms: string[] = [];
  if (args.orgId) {
    for (const id of ids) {
      rooms.push(manifestDocName(id, args.orgId));
    }
  }
  for (const id of ids) {
    rooms.push(manifestDocName(id));
  }
  return rooms;
}

function normalizeManifestSeriesRefsForOrg(
  manifest: CollectionManifestDoc,
  collectionId: string,
  orgId?: string,
): {
  manifest: CollectionManifestDoc;
  changed: boolean;
  legacyToCanonicalDocNames: Record<string, string>;
} {
  const root = manifest.content[0];
  const nodes = root.content ?? [];
  const legacyToCanonicalDocNames: Record<string, string> = {};

  let nextManifest: CollectionManifestDoc | null = null;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type !== 'seriesRef') {
      continue;
    }

    const attrs = ((node as PMNode).attrs ?? {}) as Record<string, unknown>;
    const rawDocName = String(attrs.docName ?? '').trim();
    const seriesId = deriveSeriesId(attrs, rawDocName, index);
    const canonicalDocName = canonicalSeriesDocNameForRef({
      collectionId,
      seriesId,
      docName: rawDocName,
      orgId,
    });
    const nextOrder = Number(attrs.order ?? index + 1);
    const currentOrder = Number(attrs.order ?? 0);

    if (rawDocName.length > 0 && rawDocName !== canonicalDocName) {
      legacyToCanonicalDocNames[rawDocName] = canonicalDocName;
    }

    const needsUpdate =
      rawDocName !== canonicalDocName ||
      String(attrs.seriesId ?? '') !== seriesId ||
      currentOrder !== nextOrder;

    if (!needsUpdate) {
      continue;
    }

    if (!nextManifest) {
      nextManifest = structuredClone(manifest);
    }

    const nextRoot = nextManifest.content[0];
    const nextNode = nextRoot.content[index] as PMNode;
    nextNode.attrs = {
      ...(nextNode.attrs ?? {}),
      seriesId,
      docName: canonicalDocName,
      order: nextOrder,
    };
  }

  return {
    manifest: nextManifest ?? manifest,
    changed: nextManifest != null,
    legacyToCanonicalDocNames,
  };
}

function withManifestSeriesRefs(manifest: CollectionManifestDoc, refs: ManifestSeriesRef[]): CollectionManifestDoc {
  const nextManifest = structuredClone(manifest);
  const root = nextManifest.content[0];
  const existingMetaNode = (root.content ?? []).find((node) => node.type === 'collectionMeta');
  const collectionMetaNode: PMNode =
    existingMetaNode != null
      ? structuredClone(existingMetaNode as PMNode)
      : {
          type: 'collectionMeta',
          content: [],
        };

  const seriesRefNodes = refs.map((ref) => ({
    type: 'seriesRef',
    attrs: {
      seriesId: ref.seriesId,
      title: ref.title,
      order: ref.order,
      docName: ref.docName,
    },
  }));
  root.content = [
    collectionMetaNode,
    ...seriesRefNodes,
  ] as CollectionManifestDoc['content'][0]['content'];
  return nextManifest;
}

function readManifestSeriesRefs(manifest: CollectionManifestDoc): ManifestSeriesRef[] {
  const root = manifest.content[0];
  const nodes = root.content ?? [];

  const refs: ManifestSeriesRef[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type !== 'seriesRef') {
      continue;
    }

    const attrs = (node as PMNode).attrs ?? {};
    const rawOrder = Number(attrs.order ?? index + 1);
    const normalizedOrder = Number.isFinite(rawOrder) && rawOrder > 0 ? Math.floor(rawOrder) : index + 1;
    refs.push({
      seriesId: String(attrs.seriesId ?? ''),
      title: String(attrs.title ?? 'Untitled Series'),
      order: normalizedOrder,
      docName: String(attrs.docName ?? ''),
    });
  }

  return refs.sort((a, b) => a.order - b.order);
}

function flattenHierarchyHeadingsForDocument(root: HierarchyNode, rootSeriesOrder: number = 1): HierarchyHeading[] {
  const headings: HierarchyHeading[] = [];
  const normalizedRootSeriesOrder =
    Number.isFinite(rootSeriesOrder) && rootSeriesOrder > 0 ? Math.floor(rootSeriesOrder) : 1;

  const walk = (node: HierarchyNode, depth: number, path: number[]) => {
    const ordinal = depth === 0 ? normalizedRootSeriesOrder : path[path.length - 1] ?? 1;
    headings.push({
      id: node.id,
      level: node.level,
      title: node.title,
      depth,
      pathLabel: toRomanNumeral(ordinal),
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

function createPlaceholderManifest(collectionId: string, title: string): CollectionManifestDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'collectionManifest',
        attrs: {
          collectionId,
          title,
          dates: '',
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
                    text: PLACEHOLDER_COLLECTION_META_TEXT,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function extractSeriesIdFromDocName(docName: string): string {
  const parts = docName.split(':').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? 'series';
}

function createPlaceholderSeriesDoc(seriesId: string, title: string): SeriesDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: seriesId,
          title: title || 'Untitled Series',
          dates: '',
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
                    text: PLACEHOLDER_SERIES_BODY_TEXT,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function isPlaceholderManifestDoc(manifest: CollectionManifestDoc): boolean {
  if (readManifestSeriesRefs(manifest).length > 0) {
    return false;
  }
  const description = readCollectionDescription(manifest);
  return description.includes('Synced from canonical org index');
}

function isPlaceholderSeriesDoc(doc: SeriesDoc): boolean {
  const root = doc.content.find((node) => node.type === 'series');
  if (!root) {
    return false;
  }
  const body = (root.content ?? []).find((node) => node.type === 'seriesBody');
  if (!body) {
    return false;
  }
  const text = readPlainText(body as PMNode).replace(/\s+/g, ' ').trim();
  return text.includes(PLACEHOLDER_SERIES_BODY_TEXT);
}

function buildCanonicalSeriesSeeds(args: {
  manifestsByCollectionId: Record<string, CollectionManifestDoc>;
  seriesDocs: Record<string, SeriesDoc>;
  orgId?: string;
}): Array<{ docName: string; initialValue: SeriesDoc }> {
  if (!args.orgId) {
    return [];
  }

  const seeds: Array<{ docName: string; initialValue: SeriesDoc }> = [];
  const seenDocNames = new Set<string>();

  for (const [collectionId, manifest] of Object.entries(args.manifestsByCollectionId)) {
    const normalizedManifest = normalizeManifestSeriesRefsForOrg(manifest, collectionId, args.orgId).manifest;
    for (const ref of readManifestSeriesRefs(normalizedManifest)) {
      if (!ref.docName || seenDocNames.has(ref.docName)) {
        continue;
      }

      const fallbackLegacyDocName = seriesDocName(
        collectionId,
        ref.seriesId || extractSeriesIdFromDocName(ref.docName),
      );
      const initialValue =
        args.seriesDocs[ref.docName] ??
        args.seriesDocs[fallbackLegacyDocName] ??
        createPlaceholderSeriesDoc(ref.seriesId || extractSeriesIdFromDocName(ref.docName), ref.title);

      seeds.push({
        docName: ref.docName,
        initialValue: structuredClone(initialValue),
      });
      seenDocNames.add(ref.docName);
    }
  }

  return seeds;
}

function createInitialWorkspace(): WorkspaceState {
  if (typeof window !== 'undefined' && defaultCollabEnabled()) {
    return {
      manifestsByCollectionId: {},
      collectionOrder: [],
      seriesDocs: {},
      activeCollectionId: '',
      activeSeriesDocName: '',
    };
  }

  const primaryManifestDoc = structuredClone(manifestFixture) as CollectionManifestDoc;
  const secondaryManifestDoc = createSecondaryManifestStub();
  const sourceDoc = createSeriesAStub();
  const targetDoc = createSeriesBStub();
  const tertiaryDoc = createSeriesCStub();
  const quaternaryDoc = createSeriesDStub();
  const quinaryDoc = createSeriesEStub();
  const senaryDoc = createSeriesFStub();

  const seededSource = syncSeriesBodyWithHierarchy(sourceDoc);
  const seededTarget = syncSeriesBodyWithHierarchy(targetDoc);
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
                    text: 'This series documents governance and administrative operations of the Great Lakes Railroad Historical Society and its predecessor offices. Records include board minutes, annual budgets, staffing memoranda, procurement files, and policy circulars maintained by the secretary and comptroller.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Materials are strongest for the years 1924-1938, when expansion and modernization projects generated sustained correspondence between executive leadership, legal counsel, and regional station managers.',
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
                              id: 'field-ledger-0',
                              key: 'title',
                              valueType: 'text',
                              value: 'Springfield Dispatch Ledger',
                            },
                          },
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
                    text: 'The Photographic Materials series contains prints, negatives, and contact sheets created by staff photographers and contracted studios to document facilities, rolling stock, right-of-way improvements, and railroad personnel.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Images are arranged by subject and location and often retain original caption slips with dates, train numbers, or station identifiers; gaps in coverage appear after 1939, when routine documentation shifted to departmental scrapbooks.',
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
                    text: 'This series preserves engineering drawings produced for bridge construction, station renovations, track alignments, and utility relocations. Drafting conventions and revision stamps provide evidence of design changes over multiple decades.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Most sheets are blueprint or linen copies with annotations by field engineers; oversized handling restrictions apply, and researchers should request map-case retrieval in advance.',
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
                    text: 'Policy and Governance Files document planning commission deliberations, ordinance drafting, and implementation guidance distributed to neighborhood offices. The records capture how planning priorities shifted in response to industrial decline and postwar redevelopment.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Meeting packets frequently include staff reports, annotated agenda drafts, and public comment summaries. Personally identifying information in complaint exhibits may be redacted in researcher copies.',
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
                    text: 'The Neighborhood Survey Photography series contains field photography commissioned to assess housing stock, commercial corridors, and street infrastructure prior to major planning interventions.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Photographs are commonly sequenced by survey route and block face, with matching index cards noting date, district, and inspector initials. Some late campaigns include aerial reference images from contracted firms.',
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
                    text: 'Redevelopment Project Plans include conceptual plans, phased construction drawings, environmental review exhibits, and revision sets for waterfront, transit, and mixed-use initiatives administered by the planning department.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Plan sets are arranged by project code and revision number. Companion cost summaries and milestone charts are filed with each project phase when available.',
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
