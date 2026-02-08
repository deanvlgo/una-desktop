import type { UUID } from './types';

export function manifestDocName(collectionId: UUID): string {
  return `collection:${collectionId}`;
}

export function seriesDocName(collectionId: UUID, seriesId: UUID): string {
  return `series:${collectionId}:${seriesId}`;
}

export function parseDocName(docName: string):
  | { kind: 'manifest'; collectionId: UUID }
  | { kind: 'series'; collectionId: UUID; seriesId: UUID }
  | null {
  if (docName.startsWith('collection:')) {
    const collectionId = docName.slice('collection:'.length);
    if (collectionId.length === 0) {
      return null;
    }
    return { kind: 'manifest', collectionId };
  }

  if (docName.startsWith('series:')) {
    const rest = docName.slice('series:'.length);
    const [collectionId, seriesId] = rest.split(':');
    if (!collectionId || !seriesId) {
      return null;
    }
    return { kind: 'series', collectionId, seriesId };
  }

  return null;
}
