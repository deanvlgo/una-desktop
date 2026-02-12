import type { UUID } from './types';

export function orgCollectionsDocName(orgId: UUID): string {
  return `org:${orgId}:collections`;
}

export function collectionManifestDocName(orgId: UUID, collectionId: UUID): string {
  return `collection:${orgId}:${collectionId}`;
}

export function manifestDocName(collectionId: UUID, orgId?: UUID): string {
  if (orgId) {
    return collectionManifestDocName(orgId, collectionId);
  }
  return `collection:${collectionId}`;
}

export function orgSeriesDocName(orgId: UUID, collectionId: UUID, seriesId: UUID): string {
  return `series:${orgId}:${collectionId}:${seriesId}`;
}

export function seriesDocName(collectionId: UUID, seriesId: UUID, orgId?: UUID): string {
  if (orgId) {
    return orgSeriesDocName(orgId, collectionId, seriesId);
  }
  return `series:${collectionId}:${seriesId}`;
}

export function parseDocName(docName: string):
  | { kind: 'org_index'; orgId: UUID }
  | { kind: 'manifest'; orgId?: UUID; collectionId: UUID }
  | { kind: 'series'; orgId?: UUID; collectionId: UUID; seriesId: UUID }
  | null {
  if (docName.startsWith('org:')) {
    const rest = docName.slice('org:'.length);
    const [orgId, marker] = rest.split(':');
    if (!orgId || marker !== 'collections') {
      return null;
    }
    return { kind: 'org_index', orgId };
  }

  if (docName.startsWith('collection:')) {
    const rest = docName.slice('collection:'.length);
    const parts = rest.split(':');
    if (parts.length === 1) {
      const collectionId = parts[0];
      if (!collectionId) {
        return null;
      }
      return { kind: 'manifest', collectionId };
    }
    if (parts.length === 2) {
      const [orgId, collectionId] = parts;
      if (!orgId || !collectionId) {
        return null;
      }
      return { kind: 'manifest', orgId, collectionId };
    }
    return null;
  }

  if (docName.startsWith('series:')) {
    const rest = docName.slice('series:'.length);
    const parts = rest.split(':');
    if (parts.length === 2) {
      const [collectionId, seriesId] = parts;
      if (!collectionId || !seriesId) {
        return null;
      }
      return { kind: 'series', collectionId, seriesId };
    }
    if (parts.length === 3) {
      const [orgId, collectionId, seriesId] = parts;
      if (!orgId || !collectionId || !seriesId) {
        return null;
      }
      return { kind: 'series', orgId, collectionId, seriesId };
    }
    return null;
  }

  return null;
}
