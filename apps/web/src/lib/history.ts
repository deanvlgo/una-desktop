export type HistorySnapshot = {
  id: number;
  createdAt: string;
  actorId: string | null;
  actorType: string | null;
  requestId: string | null;
  source: string | null;
  summary: string | null;
  revertedFromSnapshotId: number | null;
  previousSnapshotId: number | null;
  diffStatus: 'pending' | 'processing' | 'done' | 'failed' | null;
  diffError: string | null;
};

export type CollectionSeriesRefCandidate = {
  docName: string;
  seriesId: string;
  title: string;
  order: number;
  sourceLevel: string | null;
  updatedAt: string;
};

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

function collabHttpBaseUrl(): string {
  const wsUrl =
    (import.meta.env.VITE_HOCUS_URL as string | undefined) ??
    (import.meta.env.VITE_HOCUSPOCUS_URL as string | undefined) ??
    defaultCollabWsUrl();

  const normalized = wsUrl.replace(/\/$/, '');
  if (normalized.startsWith('wss://')) {
    return `https://${normalized.slice('wss://'.length)}`;
  }
  if (normalized.startsWith('ws://')) {
    return `http://${normalized.slice('ws://'.length)}`;
  }
  if (normalized.startsWith('https://') || normalized.startsWith('http://')) {
    return normalized;
  }
  return `http://${normalized}`;
}

export async function fetchHistorySnapshots(args: {
  token: string;
  documentName: string;
  limit?: number;
}): Promise<HistorySnapshot[]> {
  const base = collabHttpBaseUrl();
  const url = new URL(`${base}/history/snapshots`);
  url.searchParams.set('documentName', args.documentName);
  url.searchParams.set('limit', String(args.limit ?? 30));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${args.token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to load history snapshots.');
  }

  const data = (await response.json()) as { snapshots?: HistorySnapshot[] };
  return Array.isArray(data.snapshots) ? data.snapshots : [];
}

export async function revertHistorySnapshot(args: {
  token: string;
  documentName: string;
  snapshotId: number;
}): Promise<void> {
  const base = collabHttpBaseUrl();
  const response = await fetch(`${base}/history/revert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      documentName: args.documentName,
      snapshotId: args.snapshotId,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to revert snapshot.');
  }
}

export async function fetchCollectionSeriesRefs(args: {
  token: string;
  collectionId: string;
}): Promise<CollectionSeriesRefCandidate[]> {
  const base = collabHttpBaseUrl();
  const url = new URL(`${base}/history/series-refs`);
  url.searchParams.set('collectionId', args.collectionId);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${args.token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to load collection series refs.');
  }

  const data = (await response.json()) as { refs?: CollectionSeriesRefCandidate[] };
  return Array.isArray(data.refs) ? data.refs : [];
}
