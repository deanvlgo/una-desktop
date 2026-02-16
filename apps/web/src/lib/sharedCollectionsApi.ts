import { apiFetch, apiFetchWithBase } from './api';
import type { OrgCollectionIndexEntry } from './canonicalRooms';

type SharedCollectionsResponse = {
  collections?: SharedCollectionEntry[];
};

type SharedCollectionResponse = {
  collection?: SharedCollectionEntry;
};

type SharedCollectionEntry = {
  collectionId?: string;
  title?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  workflowStatus?: string;
  submittedAt?: string | null;
  lastEditedBy?: string;
  isArchived?: boolean;
  sourceObjectId?: string;
  entryType?: string;
};

const WORKFLOW_STATUS_VALUES = new Set<OrgCollectionIndexEntry['workflowStatus']>([
  'describe_started',
  'refine_in_progress',
  'submitted_in_una',
  'finalized',
]);

const ENTRY_TYPE_VALUES = new Set<NonNullable<OrgCollectionIndexEntry['entryType']>>([
  'standard',
  'guided',
  'post_hoc',
]);

function readEnabledFlag(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function sharedCollectionsApiEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search).get('sharedCollectionsApi');
    if (query != null) {
      return query !== '0';
    }
  }
  return readEnabledFlag(import.meta.env.VITE_USE_SHARED_COLLECTIONS_API);
}

function readSharedCollectionsApiBaseUrl(): string | null {
  if (typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search).get('sharedCollectionsApiBase');
    if (query && query.trim().length > 0) {
      return query.trim();
    }
  }

  const raw = import.meta.env.VITE_SHARED_COLLECTIONS_API_BASE_URL;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw.trim();
}

async function sharedCollectionsFetch(path: string, init: RequestInit = {}) {
  const sharedBase = readSharedCollectionsApiBaseUrl();
  if (sharedBase) {
    return apiFetchWithBase(sharedBase, path, init);
  }
  return apiFetch(path, init);
}

function normalizeIso(value: unknown, fallbackIso: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallbackIso;
  }
  const normalized = value.trim();
  const millis = Date.parse(normalized);
  if (Number.isNaN(millis)) {
    return fallbackIso;
  }
  return new Date(millis).toISOString();
}

function normalizeWorkflowStatus(value: unknown): OrgCollectionIndexEntry['workflowStatus'] {
  if (typeof value !== 'string') {
    return 'describe_started';
  }
  return WORKFLOW_STATUS_VALUES.has(value as OrgCollectionIndexEntry['workflowStatus'])
    ? (value as OrgCollectionIndexEntry['workflowStatus'])
    : 'describe_started';
}

function normalizeEntry(entry: SharedCollectionEntry): OrgCollectionIndexEntry | null {
  const collectionId = typeof entry.collectionId === 'string' ? entry.collectionId.trim() : '';
  if (collectionId.length === 0) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const createdAt = normalizeIso(entry.createdAt, nowIso);
  const updatedAt = normalizeIso(entry.updatedAt, createdAt);
  const entryTypeRaw = typeof entry.entryType === 'string' ? entry.entryType.trim() : '';
  const entryType = ENTRY_TYPE_VALUES.has(entryTypeRaw as NonNullable<OrgCollectionIndexEntry['entryType']>)
    ? (entryTypeRaw as NonNullable<OrgCollectionIndexEntry['entryType']>)
    : undefined;

  return {
    collectionId,
    title: typeof entry.title === 'string' && entry.title.trim().length > 0 ? entry.title.trim() : collectionId,
    createdBy: typeof entry.createdBy === 'string' && entry.createdBy.trim().length > 0 ? entry.createdBy : 'unknown',
    createdAt,
    updatedAt,
    workflowStatus: normalizeWorkflowStatus(entry.workflowStatus),
    submittedAt: typeof entry.submittedAt === 'string' && entry.submittedAt.trim().length > 0 ? entry.submittedAt : null,
    lastEditedBy: typeof entry.lastEditedBy === 'string' && entry.lastEditedBy.trim().length > 0 ? entry.lastEditedBy : undefined,
    isArchived: Boolean(entry.isArchived),
    sourceObjectId:
      typeof entry.sourceObjectId === 'string' && entry.sourceObjectId.trim().length > 0
        ? entry.sourceObjectId
        : collectionId,
    entryType,
  };
}

export async function fetchSharedCollectionEntries(): Promise<Record<string, OrgCollectionIndexEntry>> {
  const response = await sharedCollectionsFetch('/api/una/v1/collections');
  if (!response.ok) {
    throw new Error(`Shared collections API failed (${response.status})`);
  }

  const payload = (await response.json()) as SharedCollectionsResponse;
  const entries = Array.isArray(payload.collections) ? payload.collections : [];
  const result: Record<string, OrgCollectionIndexEntry> = {};
  for (const entry of entries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    result[normalized.collectionId] = normalized;
  }
  return result;
}

export async function patchSharedCollectionEntry(args: {
  collectionId: string;
  patch: {
    title?: string;
    workflowStatus?: OrgCollectionIndexEntry['workflowStatus'];
    submittedAt?: string | null;
    isArchived?: boolean;
  };
}): Promise<OrgCollectionIndexEntry | null> {
  const response = await sharedCollectionsFetch(`/api/una/v1/collections/${encodeURIComponent(args.collectionId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.patch),
  });

  if (!response.ok) {
    throw new Error(`Shared collections patch failed (${response.status})`);
  }

  const payload = (await response.json()) as SharedCollectionResponse;
  if (!payload.collection) {
    return null;
  }
  return normalizeEntry(payload.collection);
}
