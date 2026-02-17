import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import WS from 'ws';

const DEFAULT_HOCUS_URL = 'ws://127.0.0.1:1234';

function env(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function manifestDocName(collectionId, orgId) {
  if (orgId) {
    return `collection:${orgId}:${collectionId}`;
  }
  return `collection:${collectionId}`;
}

function seriesDocName(collectionId, seriesId, orgId) {
  if (orgId) {
    return `series:${orgId}:${collectionId}:${seriesId}`;
  }
  return `series:${collectionId}:${seriesId}`;
}

function orgCollectionsDocName(orgId) {
  return `org:${orgId}:collections`;
}

function paragraph(text) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

function createSeriesDoc({ seriesId, title, dates, refCode, bodyText, itemTitle }) {
  return {
    type: 'doc',
    content: [
      {
        type: 'series',
        attrs: {
          id: seriesId,
          title,
          dates,
          refCode,
        },
        content: [
          { type: 'seriesOps', content: [] },
          { type: 'seriesBody', content: [paragraph(bodyText)] },
          {
            type: 'subseries',
            attrs: {
              id: `subseries-${seriesId}-1`,
              title: `${title} Subseries`,
            },
            content: [
              {
                type: 'file',
                attrs: {
                  id: `file-${seriesId}-1`,
                  title: `${title} File`,
                },
                content: [
                  {
                    type: 'item',
                    attrs: {
                      id: `item-${seriesId}-1`,
                      itemType: 'document',
                    },
                    content: [
                      {
                        type: 'itemFields',
                        content: [
                          {
                            type: 'field',
                            attrs: {
                              id: `field-${seriesId}-title`,
                              key: 'title',
                              valueType: 'text',
                              value: itemTitle,
                            },
                          },
                        ],
                      },
                      {
                        type: 'itemBody',
                        content: [paragraph('Sample item description.')],
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
  };
}

function createManifestDoc({ collectionId, title, dates, description, refs }) {
  return {
    type: 'doc',
    content: [
      {
        type: 'collectionManifest',
        attrs: {
          collectionId,
          title,
          dates,
        },
        content: [
          {
            type: 'collectionMeta',
            content: [paragraph(description)],
          },
          ...refs.map((ref, index) => ({
            type: 'seriesRef',
            attrs: {
              seriesId: ref.seriesId,
              title: ref.title,
              order: index + 1,
              docName: ref.docName,
            },
          })),
        ],
      },
    ],
  };
}

function seedData(orgId) {
  const railroadRefs = [
    { seriesId: 'series-a', title: 'Administrative and Governance Records' },
    { seriesId: 'series-b', title: 'Photographic Materials' },
    { seriesId: 'series-c', title: 'Engineering Drawings and Maps' },
  ].map((ref) => ({
    ...ref,
    docName: seriesDocName('col-001', ref.seriesId, orgId),
  }));

  const cityPlanningRefs = [
    { seriesId: 'series-d', title: 'Policy and Governance Files' },
    { seriesId: 'series-e', title: 'Neighborhood Survey Photography' },
    { seriesId: 'series-f', title: 'Urban Renewal and Redevelopment Case Files' },
  ].map((ref) => ({
    ...ref,
    docName: seriesDocName('col-002', ref.seriesId, orgId),
  }));

  const manifests = [
    {
      collectionId: 'col-001',
      title: 'Railroad Company Records',
      dates: '1890-1987',
      description: 'Administrative, photographic, and engineering documentation of regional rail operations.',
      refs: railroadRefs,
    },
    {
      collectionId: 'col-002',
      title: 'City Planning Department Records Policy and Governance Files',
      dates: '1925-2004',
      description: 'Municipal planning records covering zoning, redevelopment, and civic design initiatives.',
      refs: cityPlanningRefs,
    },
  ];

  const seriesDocs = [
    createSeriesDoc({
      seriesId: 'series-a',
      title: 'Administrative and Governance Records',
      dates: '1890-1987',
      refCode: 'RR-1',
      bodyText: 'Board minutes, annual reports, and policy correspondence documenting railroad governance.',
      itemTitle: 'Board minutes sample',
    }),
    createSeriesDoc({
      seriesId: 'series-b',
      title: 'Photographic Materials',
      dates: '1902-1980',
      refCode: 'RR-2',
      bodyText: 'Photographs of stations, locomotives, and operations organized by route and date.',
      itemTitle: 'Station photograph sample',
    }),
    createSeriesDoc({
      seriesId: 'series-c',
      title: 'Engineering Drawings and Maps',
      dates: '1911-1974',
      refCode: 'RR-3',
      bodyText: 'Track charts, bridge drawings, and engineering plans for construction and maintenance.',
      itemTitle: 'Bridge plan sample',
    }),
    createSeriesDoc({
      seriesId: 'series-d',
      title: 'Policy and Governance Files',
      dates: '1925-2004',
      refCode: 'CP-1',
      bodyText: 'Planning commission records, policy directives, and interdepartmental governance documentation.',
      itemTitle: 'Policy memo sample',
    }),
    createSeriesDoc({
      seriesId: 'series-e',
      title: 'Neighborhood Survey Photography',
      dates: '1932-1991',
      refCode: 'CP-2',
      bodyText: 'Field photographs documenting neighborhoods, block faces, and built infrastructure before interventions.',
      itemTitle: 'Neighborhood survey image sample',
    }),
    createSeriesDoc({
      seriesId: 'series-f',
      title: 'Urban Renewal and Redevelopment Case Files',
      dates: '1948-2001',
      refCode: 'CP-3',
      bodyText: 'Case files for redevelopment projects including plans, correspondence, and public hearing materials.',
      itemTitle: 'Redevelopment case file sample',
    }),
  ];

  return {
    manifests: manifests.map((entry) => ({
      collectionId: entry.collectionId,
      roomOrg: manifestDocName(entry.collectionId, orgId),
      roomLegacy: manifestDocName(entry.collectionId),
      docOrg: createManifestDoc(entry),
      docLegacy: createManifestDoc({
        ...entry,
        refs: entry.refs.map((ref) => ({
          ...ref,
          docName: seriesDocName(entry.collectionId, ref.seriesId),
        })),
      }),
    })),
    series: [
      { collectionId: 'col-001', seriesId: 'series-a', doc: seriesDocs[0] },
      { collectionId: 'col-001', seriesId: 'series-b', doc: seriesDocs[1] },
      { collectionId: 'col-001', seriesId: 'series-c', doc: seriesDocs[2] },
      { collectionId: 'col-002', seriesId: 'series-d', doc: seriesDocs[3] },
      { collectionId: 'col-002', seriesId: 'series-e', doc: seriesDocs[4] },
      { collectionId: 'col-002', seriesId: 'series-f', doc: seriesDocs[5] },
    ],
  };
}

function waitForRoomReady(provider, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, timeoutMs);

    const handleSynced = ({ state }) => {
      if (!state || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const handleStatus = ({ status }) => {
      if (settled) return;
      if (status !== 'connected') return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    provider.on('synced', handleSynced);
    provider.on('status', handleStatus);
  });
}

async function withRoom({ hocusUrl, token, roomName }, fn) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: hocusUrl,
    name: roomName,
    document: doc,
    token,
    WebSocketPolyfill: WS,
  });

  try {
    await waitForRoomReady(provider);
    await fn(doc);
    await new Promise((resolve) => setTimeout(resolve, 350));
  } finally {
    provider.destroy();
    doc.destroy();
  }
}

async function seedIndex({ hocusUrl, token, orgId, userId }) {
  const roomName = orgCollectionsDocName(orgId);
  await withRoom({ hocusUrl, token, roomName }, async (doc) => {
    const map = doc.getMap('collections');
    map.clear();

    const now = new Date().toISOString();
    const entries = [
      {
        collectionId: 'col-001',
        title: 'Railroad Company Records',
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        workflowStatus: 'describe_started',
        submittedAt: null,
        lastEditedBy: userId,
        isArchived: false,
        entryType: 'guided',
      },
      {
        collectionId: 'col-002',
        title: 'City Planning Department Records Policy and Governance Files',
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        workflowStatus: 'describe_started',
        submittedAt: null,
        lastEditedBy: userId,
        isArchived: false,
        entryType: 'guided',
      },
    ];

    for (const entry of entries) {
      map.set(entry.collectionId, JSON.stringify(entry));
    }
  });
}

async function writeJsonRoom({ hocusUrl, token, roomName, json }) {
  await withRoom({ hocusUrl, token, roomName }, async (doc) => {
    const map = doc.getMap('state');
    map.set('json', json);
  });
}

async function main() {
  const token = requiredEnv('SEED_AUTH_TOKEN');
  const claims = decodeJwtPayload(token) ?? {};
  const orgId =
    env('SEED_ORG_ID') ||
    String(claims.organization_id ?? claims.org_id ?? claims.orgId ?? claims.org ?? '').trim();
  if (!orgId) {
    throw new Error('Missing org id. Set SEED_ORG_ID or use a JWT with organization_id/org_id claim.');
  }

  const userId = env('SEED_USER_ID') || String(claims.sub ?? claims.user_id ?? 'seed-script');
  const hocusUrl = env('SEED_HOCUS_URL') || DEFAULT_HOCUS_URL;

  const data = seedData(orgId);
  console.log(`[seed] hocus=${hocusUrl}`);
  console.log(`[seed] org=${orgId}`);

  await seedIndex({ hocusUrl, token, orgId, userId });
  console.log('[seed] reset org collections index');

  for (const manifest of data.manifests) {
    await writeJsonRoom({
      hocusUrl,
      token,
      roomName: manifest.roomOrg,
      json: manifest.docOrg,
    });
    await writeJsonRoom({
      hocusUrl,
      token,
      roomName: manifest.roomLegacy,
      json: manifest.docLegacy,
    });
    console.log(`[seed] wrote manifest ${manifest.collectionId}`);
  }

  for (const series of data.series) {
    await writeJsonRoom({
      hocusUrl,
      token,
      roomName: seriesDocName(series.collectionId, series.seriesId, orgId),
      json: series.doc,
    });
    await writeJsonRoom({
      hocusUrl,
      token,
      roomName: seriesDocName(series.collectionId, series.seriesId),
      json: series.doc,
    });
    console.log(`[seed] wrote series ${series.collectionId}/${series.seriesId}`);
  }

  console.log('[seed] done');
}

main().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});
