import { cloneDoc } from './tree';
import type { CollectionManifestDoc, PMDoc, PMMark, PMNode, SeriesDoc, SeriesRefNode } from './types';

export type ExportArgs = {
  manifestDoc: CollectionManifestDoc;
  seriesDocsByDocName: Record<string, SeriesDoc>;
};

export function stripSuggestionArtifacts<T extends PMDoc | PMNode>(root: T): T {
  const next = cloneDoc(root);

  const stripped = stripNode(next as PMNode | PMDoc);
  if (!stripped) {
    return ({ type: 'doc', content: [] } as unknown) as T;
  }

  return stripped as T;
}

export function exportCollection(args: ExportArgs): PMDoc {
  const manifestRoot = args.manifestDoc.content[0];
  const seriesRefs = manifestRoot.content.filter((node): node is SeriesRefNode => node.type === 'seriesRef');

  const collectionNode: PMNode = {
    type: 'collection',
    attrs: {
      collectionId: manifestRoot.attrs.collectionId,
      title: manifestRoot.attrs.title,
      ...(manifestRoot.attrs.dates ? { dates: manifestRoot.attrs.dates } : {}),
    },
    content: [],
  };

  for (const ref of seriesRefs) {
    const seriesDoc = args.seriesDocsByDocName[ref.attrs.docName];
    if (!seriesDoc) {
      throw new Error(`Missing series doc for ${ref.attrs.docName}`);
    }

    const stripped = stripSuggestionArtifacts(seriesDoc);
    const seriesRoot = stripped.content.find((node) => node.type === 'series');
    if (!seriesRoot) {
      throw new Error(`Series doc ${ref.attrs.docName} has no series root`);
    }

    collectionNode.content?.push(seriesRoot);
  }

  return {
    type: 'doc',
    content: [collectionNode],
  };
}

function stripNode(node: PMDoc | PMNode): PMDoc | PMNode | null {
  if ((node as PMNode).type === 'suggestion_block') {
    return null;
  }

  if ((node as PMNode).type === 'suggestion_delete') {
    return null;
  }

  if ((node as PMNode).type === 'seriesOps') {
    return null;
  }

  const next: PMDoc | PMNode = cloneDoc(node);

  if ((next as PMNode).type === 'text' && (next as PMNode).marks) {
    const marks = ((next as PMNode).marks ?? []).filter((mark: PMMark) => mark.type !== 'suggestion_insert');
    if (marks.length === 0) {
      delete (next as PMNode).marks;
    } else {
      (next as PMNode).marks = marks;
    }
  }

  const content = (next as PMNode | PMDoc).content;
  if (content) {
    const strippedChildren: PMNode[] = [];
    for (const child of content) {
      const stripped = stripNode(child);
      if (!stripped) {
        continue;
      }
      strippedChildren.push(stripped as PMNode);
    }
    (next as PMNode | PMDoc).content = strippedChildren;
  }

  return next;
}
