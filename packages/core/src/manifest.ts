import { cloneDoc } from './tree';
import type { CollectionManifestDoc, SeriesRefNode, UUID } from './types';

export type ManifestInvariantResult = {
  valid: boolean;
  errors: string[];
};

function rootNode(doc: CollectionManifestDoc) {
  return doc.content[0];
}

export function listSeriesRefs(doc: CollectionManifestDoc): SeriesRefNode[] {
  return rootNode(doc).content.filter((node): node is SeriesRefNode => node.type === 'seriesRef');
}

export function validateManifestInvariants(doc: CollectionManifestDoc): ManifestInvariantResult {
  const refs = listSeriesRefs(doc);
  const errors: string[] = [];

  const seenSeriesIds = new Set<string>();
  const seenDocNames = new Set<string>();

  for (const ref of refs) {
    const seriesId = ref.attrs.seriesId;
    if (seenSeriesIds.has(seriesId)) {
      errors.push(`Duplicate seriesId: ${seriesId}`);
    }
    seenSeriesIds.add(seriesId);

    const docName = ref.attrs.docName;
    if (seenDocNames.has(docName)) {
      errors.push(`Duplicate docName: ${docName}`);
    }
    seenDocNames.add(docName);
  }

  for (const ref of refs) {
    const expectedSuffix = `:${ref.attrs.seriesId}`;
    if (!ref.attrs.docName.startsWith('series:') || !ref.attrs.docName.endsWith(expectedSuffix)) {
      errors.push(`seriesRef ${ref.attrs.seriesId} has invalid docName ${ref.attrs.docName}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function reorderSeriesRefs(doc: CollectionManifestDoc, orderedSeriesIds: UUID[]): CollectionManifestDoc {
  const next = cloneDoc(doc);
  const root = rootNode(next);

  const firstMeta = root.content.find((node) => node.type === 'collectionMeta');
  const refs = listSeriesRefs(next);

  const byId = new Map(refs.map((ref) => [ref.attrs.seriesId, ref]));

  const reordered: SeriesRefNode[] = [];
  for (const seriesId of orderedSeriesIds) {
    const ref = byId.get(seriesId);
    if (ref) {
      reordered.push(ref);
      byId.delete(seriesId);
    }
  }

  for (const ref of refs) {
    if (byId.has(ref.attrs.seriesId)) {
      reordered.push(ref);
    }
  }

  reordered.forEach((ref, index) => {
    ref.attrs.order = index + 1;
  });

  const meta = firstMeta ?? { type: 'collectionMeta', content: [] };
  root.content = [meta, ...reordered] as CollectionManifestDoc['content'][0]['content'];
  return next;
}

export function moveSeriesRef(doc: CollectionManifestDoc, fromIndex: number, toIndex: number): CollectionManifestDoc {
  const refs = listSeriesRefs(doc);
  if (fromIndex < 0 || fromIndex >= refs.length || toIndex < 0 || toIndex >= refs.length) {
    return cloneDoc(doc);
  }

  const ordered = refs.map((ref) => ref.attrs.seriesId);
  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);
  return reorderSeriesRefs(doc, ordered);
}
