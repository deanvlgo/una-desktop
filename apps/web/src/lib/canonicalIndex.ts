import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import type { OrgCollectionIndexEntry } from './canonicalRooms';
import { orgCollectionsDocName } from './canonicalRooms';

const COLLECTIONS_MAP_KEY = 'collections';
const DEFAULT_HOCUS_URL = 'ws://localhost:1234';
const CONNECTION_RELEASE_DELAY_MS = 300;

function hocusUrl() {
  const raw = import.meta.env.VITE_HOCUS_URL;
  if (!raw) {
    return DEFAULT_HOCUS_URL;
  }
  return String(raw).trim();
}

export type OrgIndexConnection = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  map: Y.Map<string>;
};

type ManagedOrgIndexConnection = OrgIndexConnection & {
  key: string;
  refCount: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
};

const sharedConnections = new Map<string, ManagedOrgIndexConnection>();

export function connectOrgIndex(orgId: string, token: string): OrgIndexConnection {
  const key = `${orgId}::${token}`;
  const existing = sharedConnections.get(key);
  if (existing) {
    existing.refCount += 1;
    if (existing.destroyTimer) {
      clearTimeout(existing.destroyTimer);
      existing.destroyTimer = null;
    }
    return existing;
  }

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: hocusUrl(),
    name: orgCollectionsDocName(orgId),
    document: doc,
    token,
  });

  const map = doc.getMap<string>(COLLECTIONS_MAP_KEY);

  const managed: ManagedOrgIndexConnection = {
    key,
    refCount: 1,
    destroyTimer: null,
    doc,
    provider,
    map,
  };

  sharedConnections.set(key, managed);
  return managed;
}

export function disconnectOrgIndex(connection: OrgIndexConnection) {
  const managed = connection as ManagedOrgIndexConnection;
  if (!managed.key) {
    connection.provider.destroy();
    connection.doc.destroy();
    return;
  }

  const current = sharedConnections.get(managed.key);
  if (!current || current !== managed) {
    connection.provider.destroy();
    connection.doc.destroy();
    return;
  }

  current.refCount = Math.max(0, current.refCount - 1);
  if (current.refCount > 0) {
    return;
  }

  if (current.destroyTimer) {
    clearTimeout(current.destroyTimer);
  }

  current.destroyTimer = setTimeout(() => {
    const latest = sharedConnections.get(current.key);
    if (!latest || latest !== current || latest.refCount > 0) {
      return;
    }
    latest.provider.destroy();
    latest.doc.destroy();
    sharedConnections.delete(current.key);
  }, CONNECTION_RELEASE_DELAY_MS);
}

function normalizeEntry(collectionId: string, raw: unknown): OrgCollectionIndexEntry | null {
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OrgCollectionIndexEntry>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0 ? parsed.title : collectionId;
    const createdBy = typeof parsed.createdBy === 'string' && parsed.createdBy.length > 0 ? parsed.createdBy : 'unknown';
    const createdAt = typeof parsed.createdAt === 'string' && parsed.createdAt.length > 0 ? parsed.createdAt : new Date(0).toISOString();
    const updatedAt = typeof parsed.updatedAt === 'string' && parsed.updatedAt.length > 0 ? parsed.updatedAt : createdAt;

    const workflowStatus =
      parsed.workflowStatus === 'describe_started' ||
      parsed.workflowStatus === 'refine_in_progress' ||
      parsed.workflowStatus === 'submitted_in_una' ||
      parsed.workflowStatus === 'finalized'
        ? parsed.workflowStatus
        : 'describe_started';

    const submittedAt = typeof parsed.submittedAt === 'string' && parsed.submittedAt.length > 0 ? parsed.submittedAt : null;

    return {
      collectionId,
      title,
      createdBy,
      createdAt,
      updatedAt,
      workflowStatus,
      submittedAt,
      lastEditedBy: typeof parsed.lastEditedBy === 'string' ? parsed.lastEditedBy : undefined,
      isArchived: Boolean(parsed.isArchived),
      sourceObjectId: typeof parsed.sourceObjectId === 'string' ? parsed.sourceObjectId : undefined,
      entryType: parsed.entryType === 'guided' || parsed.entryType === 'post_hoc' || parsed.entryType === 'standard'
        ? parsed.entryType
        : undefined,
    };
  } catch {
    return null;
  }
}

export function readOrgIndexEntries(map: Y.Map<string>): OrgCollectionIndexEntry[] {
  const entries: OrgCollectionIndexEntry[] = [];
  map.forEach((value, key) => {
    const parsed = normalizeEntry(key, value);
    if (parsed) {
      entries.push(parsed);
    }
  });

  return entries.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

export function getOrgIndexEntry(map: Y.Map<string>, collectionId: string): OrgCollectionIndexEntry | null {
  return normalizeEntry(collectionId, map.get(collectionId));
}

export function upsertOrgIndexEntry(map: Y.Map<string>, entry: OrgCollectionIndexEntry) {
  map.set(entry.collectionId, JSON.stringify(entry));
}
