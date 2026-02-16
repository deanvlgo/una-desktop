import { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from '@hocuspocus/extension-database';
import { Server } from '@hocuspocus/server';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import * as Y from 'yjs';

const DEFAULT_PORT = 1234;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SNAPSHOT_INTERVAL_MS = 60_000;

const port = Number(process.env.HOCUSPOCUS_PORT ?? DEFAULT_PORT);
const host = process.env.HOCUSPOCUS_HOST ?? DEFAULT_HOST;
const jwtSecret = String(process.env.JWT_SECRET_KEY ?? '').trim();
const fallbackStaticToken = String(process.env.COLLAB_AUTH_TOKEN ?? '').trim();
const postgresConnectionString = String(
  process.env.HOCUSPOCUS_DATABASE_URL ?? process.env.HISTORIQ_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
).trim();
const postgresSchema = String(process.env.HOCUSPOCUS_DB_SCHEMA ?? 'collab').trim();
const postgresDocumentsTable = String(process.env.HOCUSPOCUS_DB_TABLE ?? 'documents').trim();
const postgresSnapshotsTable = String(process.env.HOCUSPOCUS_SNAPSHOTS_TABLE ?? 'document_snapshots').trim();
const postgresUpdatesTable = String(process.env.HOCUSPOCUS_UPDATES_TABLE ?? 'document_updates').trim();
const snapshotIntervalMs = Number(process.env.HOCUSPOCUS_SNAPSHOT_INTERVAL_MS ?? DEFAULT_SNAPSHOT_INTERVAL_MS);
const geminiApiKey = String(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
const geminiModel = String(process.env.GEMINI_SNAPSHOT_MODEL ?? 'gemini-2.5-flash-lite').trim();
const diffWorkerEnabled = String(process.env.HOCUSPOCUS_DIFF_WORKER_ENABLED ?? '1').trim() !== '0';
const diffWorkerIntervalMs = Math.max(500, Number(process.env.HOCUSPOCUS_DIFF_WORKER_INTERVAL_MS ?? 2000));
const diffWorkerMaxJobsPerTick = Math.max(1, Math.min(10, Number(process.env.HOCUSPOCUS_DIFF_WORKER_MAX_JOBS ?? 1)));

const dataDir =
  process.env.HOCUSPOCUS_DATA_DIR != null
    ? path.resolve(process.env.HOCUSPOCUS_DATA_DIR)
    : path.resolve(fileURLToPath(new URL('../.hocuspocus-data', import.meta.url)));

type ParsedRoom =
  | { kind: 'org_index'; orgId: string }
  | { kind: 'manifest'; orgId: string; collectionId: string }
  | { kind: 'series'; orgId: string; collectionId: string; seriesId: string }
  | { kind: 'legacy_manifest'; collectionId: string }
  | { kind: 'legacy_series'; collectionId: string; seriesId: string };

type TokenContext = {
  subject: string;
  org: string | null;
  actorType: 'human' | 'bot';
  requestId: string | null;
};

type HistorySnapshotRow = {
  id: number;
  created_at: Date;
  actor_id: string | null;
  actor_type: string | null;
  request_id: string | null;
  source: string | null;
  summary: string | null;
  reverted_from_snapshot_id: number | null;
  previous_snapshot_id: number | null;
  diff_status: string | null;
  diff_error: string | null;
};

type SnapshotDiffStatus = 'pending' | 'processing' | 'done' | 'failed';

type SnapshotDiffJobRow = {
  id: number;
  document_name: string;
  source: string;
  state: Buffer;
  previous_snapshot_id: number | null;
  reverted_from_snapshot_id: number | null;
};

type SnapshotDiffNodeRecord = {
  nodeId: string;
  type: string;
  title: string | null;
  parentId: string | null;
  path: string;
  text: string;
  catalogFields: Record<string, string>;
  raw: unknown;
};

type SnapshotDiffPayload = {
  documentName: string;
  source: string;
  currentSnapshotId: number;
  previousSnapshotId: number | null;
  revertedFromSnapshotId: number | null;
  stats: {
    addedNodeCount: number;
    removedNodeCount: number;
    movedNodeCount: number;
    updatedNodeCount: number;
    catalogFieldChangeCount: number;
    textSectionChangeCount: number;
  };
  nodeChanges: {
    added: Array<{ nodeId: string; type: string; title: string | null; parentId: string | null }>;
    removed: Array<{ nodeId: string; type: string; title: string | null; parentId: string | null }>;
    moved: Array<{ nodeId: string; type: string; title: string | null; fromParentId: string | null; toParentId: string | null }>;
    updated: Array<{ nodeId: string; type: string; title: string | null; changedAspects: string[] }>;
  };
  catalogChanges: {
    changedFields: Array<{ nodeId: string; field: string; before: string; after: string }>;
  };
  wordChanges: {
    sections: Array<{
      nodeId: string;
      type: string;
      title: string | null;
      addedWordCount: number;
      removedWordCount: number;
      topAddedWords: string[];
      topRemovedWords: string[];
    }>;
  };
};

type SeriesRefCandidate = {
  docName: string;
  seriesId: string;
  title: string;
  sourceLevel: string | null;
  updatedAt: Date;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function roomFilename(documentName: string): string {
  const encoded = Buffer.from(documentName, 'utf8').toString('base64url');
  return `${encoded}.bin`;
}

function roomFilePath(documentName: string): string {
  return path.join(dataDir, roomFilename(documentName));
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function parseRoomName(documentName: string): ParsedRoom | null {
  const parts = documentName.split(':');

  if (parts.length === 3 && parts[0] === 'org' && parts[2] === 'collections') {
    const orgId = parts[1]?.trim();
    if (!orgId) {
      return null;
    }
    return { kind: 'org_index', orgId };
  }

  if (parts.length === 3 && parts[0] === 'collection') {
    const orgId = parts[1]?.trim();
    const collectionId = parts[2]?.trim();
    if (!orgId || !collectionId) {
      return null;
    }
    return { kind: 'manifest', orgId, collectionId };
  }

  if (parts.length === 4 && parts[0] === 'series') {
    const orgId = parts[1]?.trim();
    const collectionId = parts[2]?.trim();
    const seriesId = parts[3]?.trim();
    if (!orgId || !collectionId || !seriesId) {
      return null;
    }
    return { kind: 'series', orgId, collectionId, seriesId };
  }

  if (parts.length === 2 && parts[0] === 'collection') {
    const collectionId = parts[1]?.trim();
    if (!collectionId) {
      return null;
    }
    return { kind: 'legacy_manifest', collectionId };
  }

  if (parts.length === 3 && parts[0] === 'series') {
    const collectionId = parts[1]?.trim();
    const seriesId = parts[2]?.trim();
    if (!collectionId || !seriesId) {
      return null;
    }
    return { kind: 'legacy_series', collectionId, seriesId };
  }

  return null;
}

function extractBearerToken(token: unknown, request?: { headers?: Record<string, unknown> }): string | null {
  if (typeof token === 'string' && token.trim().length > 0) {
    return token.trim();
  }

  const authHeader = request?.headers?.authorization ?? request?.headers?.Authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice('bearer '.length).trim();
  }

  return null;
}

function verifyJwtToken(rawToken: string): TokenContext {
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(rawToken, jwtSecret);
    if (typeof decoded === 'string') {
      throw new Error('Invalid token payload');
    }
    payload = decoded;
  } catch {
    throw new Error('Invalid token');
  }

  const org = typeof payload.org === 'string' ? payload.org : null;
  const subject = typeof payload.sub === 'string' ? payload.sub : 'unknown';
  const actorType = payload.actorType === 'bot' ? 'bot' : 'human';
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : null;

  return {
    subject,
    org,
    actorType,
    requestId,
  };
}

function authenticateToken(rawToken: string): TokenContext {
  if (!jwtSecret) {
    if (fallbackStaticToken && rawToken === fallbackStaticToken) {
      return {
        subject: 'local-static-token',
        org: null,
        actorType: 'human',
        requestId: null,
      };
    }
    throw new Error('Unauthorized');
  }

  return verifyJwtToken(rawToken);
}

function ensureRoomAccess(documentName: string, tokenContext: TokenContext): void {
  const room = parseRoomName(documentName);
  if (!room) {
    throw new Error('Invalid room name');
  }

  if (room.kind === 'org_index' || room.kind === 'manifest' || room.kind === 'series') {
    if (!tokenContext.org) {
      throw new Error('Token missing org claim');
    }
    if (room.orgId !== tokenContext.org) {
      throw new Error('Room org does not match token org');
    }
  }
}

function orgIdFromRoom(documentName: string): string | null {
  const parsed = parseRoomName(documentName);
  if (!parsed || !('orgId' in parsed)) {
    return null;
  }
  return parsed.orgId;
}

function normalizeJsonLike(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonLike(entry));
  }
  if (typeof value === 'object') {
    if ('toJSON' in (value as Record<string, unknown>) && typeof (value as { toJSON: () => unknown }).toJSON === 'function') {
      return normalizeJsonLike((value as { toJSON: () => unknown }).toJSON());
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = normalizeJsonLike(entry);
    }
    return result;
  }
  return value;
}

function readStateJsonFromSnapshot(snapshotState: Uint8Array): unknown {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshotState);
  const stateMap = doc.getMap<unknown>('state');
  return normalizeJsonLike(stateMap.get('json'));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractSeriesRefCandidateFromDoc(args: {
  documentName: string;
  data: Uint8Array;
  updatedAt: Date;
}): SeriesRefCandidate | null {
  const parsed = parseRoomName(args.documentName);
  if (!parsed || (parsed.kind !== 'series' && parsed.kind !== 'legacy_series')) {
    return null;
  }

  const json = readStateJsonFromSnapshot(args.data);
  const stateRecord = asRecord(json);
  if (!stateRecord) {
    return null;
  }

  const content = Array.isArray(stateRecord.content) ? stateRecord.content : [];
  const seriesRoot = content
    .map((entry) => asRecord(entry))
    .find((entry) => entry && entry.type === 'series');
  if (!seriesRoot) {
    return null;
  }

  const attrs = asRecord(seriesRoot.attrs) ?? {};
  const title =
    typeof attrs.title === 'string' && attrs.title.trim().length > 0
      ? attrs.title.trim()
      : parsed.seriesId;
  const sourceLevel =
    typeof attrs.sourceLevel === 'string' && attrs.sourceLevel.trim().length > 0 ? attrs.sourceLevel.trim() : null;

  return {
    docName: args.documentName,
    seriesId: parsed.seriesId,
    title,
    sourceLevel,
    updatedAt: args.updatedAt,
  };
}

function toComparableScalar(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function truncateText(value: string, max = 160): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function collectTextFromNode(node: unknown, limit = 2400): string {
  const chunks: string[] = [];
  const walk = (value: unknown): void => {
    if (chunks.join(' ').length >= limit) {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      const trimmed = record.text.trim();
      if (trimmed.length > 0) {
        chunks.push(trimmed);
      }
    }
    for (const entry of Object.values(record)) {
      walk(entry);
    }
  };
  walk(node);
  return truncateText(chunks.join(' ').replace(/\s+/g, ' ').trim(), limit);
}

function flattenCatalogFieldMap(prefix: string, value: unknown, output: Record<string, string>): void {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output[prefix] = toComparableScalar(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      flattenCatalogFieldMap(`${prefix}.${index}`, entry, output);
    });
    return;
  }

  const record = asRecord(value);
  if (!record) {
    output[prefix] = toComparableScalar(value);
    return;
  }

  for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
    flattenCatalogFieldMap(`${prefix}.${key}`, record[key], output);
  }
}

function extractCatalogFields(node: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  const record = asRecord(node);
  const attrs = record ? asRecord(record.attrs) : null;
  if (!attrs) {
    return output;
  }

  if (attrs.metadata != null) {
    flattenCatalogFieldMap('meta', attrs.metadata, output);
  }
  if (attrs.fields != null) {
    flattenCatalogFieldMap('field', attrs.fields, output);
  }

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id' || key === 'order' || key === 'metadata' || key === 'fields') {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[`attr.${key}`] = toComparableScalar(value);
    }
  }

  return output;
}

function indexSnapshotNodes(root: unknown): Map<string, SnapshotDiffNodeRecord> {
  const byId = new Map<string, SnapshotDiffNodeRecord>();

  const walk = (node: unknown, parentId: string | null, pathPrefix: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        walk(entry, parentId, `${pathPrefix}[${index}]`);
      });
      return;
    }
    const record = asRecord(node);
    if (!record) {
      return;
    }

    const attrs = asRecord(record.attrs);
    const nodeId = attrs && typeof attrs.id === 'string' ? attrs.id : null;
    const type = typeof record.type === 'string' ? record.type : 'unknown';
    const title = attrs && typeof attrs.title === 'string' ? attrs.title : null;
    const nextParentId = nodeId ?? parentId;

    if (nodeId) {
      byId.set(nodeId, {
        nodeId,
        type,
        title,
        parentId,
        path: pathPrefix,
        text: collectTextFromNode(record),
        catalogFields: extractCatalogFields(record),
        raw: record,
      });
    }

    for (const [key, value] of Object.entries(record)) {
      walk(value, nextParentId, `${pathPrefix}.${key}`);
    }
  };

  walk(root, null, 'root');
  return byId;
}

function tokenizeWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? []).slice(0, 600);
}

function topTokens(words: string[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const word of words) {
    if (word.length < 2) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([token]) => token);
}

function computeWordDiffSummary(beforeText: string, afterText: string): {
  addedWordCount: number;
  removedWordCount: number;
  topAddedWords: string[];
  topRemovedWords: string[];
} {
  const before = tokenizeWords(beforeText);
  const after = tokenizeWords(afterText);
  const m = before.length;
  const n = after.length;

  if (m === 0 && n === 0) {
    return { addedWordCount: 0, removedWordCount: 0, topAddedWords: [], topRemovedWords: [] };
  }

  // Guardrail: avoid expensive matrix work on very long sections.
  if (m * n > 220_000) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const added = after.filter((token) => !beforeSet.has(token));
    const removed = before.filter((token) => !afterSet.has(token));
    return {
      addedWordCount: added.length,
      removedWordCount: removed.length,
      topAddedWords: topTokens(added),
      topRemovedWords: topTokens(removed),
    };
  }

  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const added: string[] = [];
  const removed: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      i -= 1;
      j -= 1;
      continue;
    }
    if (dp[i - 1][j] >= dp[i][j - 1]) {
      removed.push(before[i - 1]);
      i -= 1;
    } else {
      added.push(after[j - 1]);
      j -= 1;
    }
  }
  while (i > 0) {
    removed.push(before[i - 1]);
    i -= 1;
  }
  while (j > 0) {
    added.push(after[j - 1]);
    j -= 1;
  }

  return {
    addedWordCount: added.length,
    removedWordCount: removed.length,
    topAddedWords: topTokens(added),
    topRemovedWords: topTokens(removed),
  };
}

function buildSnapshotDiffPayload(args: {
  documentName: string;
  source: string;
  currentSnapshotId: number;
  previousSnapshotId: number | null;
  revertedFromSnapshotId: number | null;
  previousState: Uint8Array | null;
  currentState: Uint8Array;
}): SnapshotDiffPayload {
  const beforeRoot = args.previousState ? readStateJsonFromSnapshot(args.previousState) : null;
  const afterRoot = readStateJsonFromSnapshot(args.currentState);
  const beforeNodes = indexSnapshotNodes(beforeRoot);
  const afterNodes = indexSnapshotNodes(afterRoot);

  const added: SnapshotDiffPayload['nodeChanges']['added'] = [];
  const removed: SnapshotDiffPayload['nodeChanges']['removed'] = [];
  const moved: SnapshotDiffPayload['nodeChanges']['moved'] = [];
  const updated: SnapshotDiffPayload['nodeChanges']['updated'] = [];
  const changedFields: SnapshotDiffPayload['catalogChanges']['changedFields'] = [];
  const sections: SnapshotDiffPayload['wordChanges']['sections'] = [];

  for (const [nodeId, afterNode] of afterNodes.entries()) {
    if (!beforeNodes.has(nodeId)) {
      added.push({
        nodeId,
        type: afterNode.type,
        title: afterNode.title,
        parentId: afterNode.parentId,
      });
    }
  }

  for (const [nodeId, beforeNode] of beforeNodes.entries()) {
    if (!afterNodes.has(nodeId)) {
      removed.push({
        nodeId,
        type: beforeNode.type,
        title: beforeNode.title,
        parentId: beforeNode.parentId,
      });
    }
  }

  for (const [nodeId, afterNode] of afterNodes.entries()) {
    const beforeNode = beforeNodes.get(nodeId);
    if (!beforeNode) {
      continue;
    }

    if (beforeNode.parentId !== afterNode.parentId) {
      moved.push({
        nodeId,
        type: afterNode.type,
        title: afterNode.title,
        fromParentId: beforeNode.parentId,
        toParentId: afterNode.parentId,
      });
    }

    const changedAspects: string[] = [];
    if (beforeNode.type !== afterNode.type) {
      changedAspects.push('type');
    }
    if ((beforeNode.title ?? '') !== (afterNode.title ?? '')) {
      changedAspects.push('title');
    }
    if (beforeNode.text !== afterNode.text) {
      changedAspects.push('text');
    }

    const catalogKeys = new Set([...Object.keys(beforeNode.catalogFields), ...Object.keys(afterNode.catalogFields)]);
    let catalogChanged = false;
    for (const field of Array.from(catalogKeys).sort((left, right) => left.localeCompare(right))) {
      const beforeValue = beforeNode.catalogFields[field] ?? '';
      const afterValue = afterNode.catalogFields[field] ?? '';
      if (beforeValue !== afterValue) {
        catalogChanged = true;
        changedFields.push({
          nodeId,
          field,
          before: truncateText(beforeValue, 180),
          after: truncateText(afterValue, 180),
        });
      }
    }
    if (catalogChanged) {
      changedAspects.push('catalog');
    }

    if (changedAspects.length > 0) {
      updated.push({
        nodeId,
        type: afterNode.type,
        title: afterNode.title,
        changedAspects,
      });
    }

    if (beforeNode.text !== afterNode.text && sections.length < 12) {
      const words = computeWordDiffSummary(beforeNode.text, afterNode.text);
      if (words.addedWordCount > 0 || words.removedWordCount > 0) {
        sections.push({
          nodeId,
          type: afterNode.type,
          title: afterNode.title,
          addedWordCount: words.addedWordCount,
          removedWordCount: words.removedWordCount,
          topAddedWords: words.topAddedWords,
          topRemovedWords: words.topRemovedWords,
        });
      }
    }
  }

  return {
    documentName: args.documentName,
    source: args.source,
    currentSnapshotId: args.currentSnapshotId,
    previousSnapshotId: args.previousSnapshotId,
    revertedFromSnapshotId: args.revertedFromSnapshotId,
    stats: {
      addedNodeCount: added.length,
      removedNodeCount: removed.length,
      movedNodeCount: moved.length,
      updatedNodeCount: updated.length,
      catalogFieldChangeCount: changedFields.length,
      textSectionChangeCount: sections.length,
    },
    nodeChanges: {
      added: added.slice(0, 30),
      removed: removed.slice(0, 30),
      moved: moved.slice(0, 30),
      updated: updated.slice(0, 50),
    },
    catalogChanges: {
      changedFields: changedFields.slice(0, 120),
    },
    wordChanges: {
      sections,
    },
  };
}

function fallbackSnapshotSummary(source: string): string {
  if (source === 'revert') {
    return '- **Finding Aid:** Reverted finding aid content to an earlier revision.\n- **Catalog:** Restored prior catalog values for this revision.';
  }
  return '- **Finding Aid:** Updated finding aid narrative or hierarchy content.\n- **Catalog:** Updated one or more catalog metadata fields.';
}

function withRevertTag(summary: string, revertedFromSnapshotId: number): string {
  const tagLine = `- **Finding Aid:** Reverted from revision ${revertedFromSnapshotId}.`;
  const lines = summary
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const hasRevertTag = lines.some((line) => /reverted?\s+from\s+revision/i.test(line));
  if (hasRevertTag) {
    return summary;
  }
  const catalogLine = lines.find((line) => /catalog/i.test(line)) ?? '- **Catalog:** Restored prior catalog values for this revision.';
  return `${tagLine}\n${catalogLine}`;
}

function stripMarkdownFences(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('```')) {
    const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*/, '');
    return withoutOpen.replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

function normalizeSummaryLine(line: string, label: 'Finding Aid' | 'Catalog'): string {
  const withoutBullet = line.replace(/^-+\s*/, '').trim();
  const prefixRegex = new RegExp(`^\\*\\*?${label}\\*\\*?\\s*:`, 'i');
  if (prefixRegex.test(withoutBullet)) {
    const text = withoutBullet.replace(prefixRegex, '').trim();
    return `- **${label}:** ${text || 'No direct changes detected.'}`;
  }
  const genericPrefixRegex = /^(\*\*[^*]+\*\*|[A-Za-z ]+)\s*:/;
  if (genericPrefixRegex.test(withoutBullet)) {
    const text = withoutBullet.replace(genericPrefixRegex, '').trim();
    return `- **${label}:** ${text || 'No direct changes detected.'}`;
  }
  return `- **${label}:** ${withoutBullet || 'No direct changes detected.'}`;
}

function cleanSnapshotSummary(value: string, source: string): string {
  const stripped = stripMarkdownFences(value);
  if (!stripped) {
    return fallbackSnapshotSummary(source);
  }

  const lines = stripped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bulletLines = lines.filter((line) => line.startsWith('-'));
  const normalizedFindingAid =
    bulletLines.find((line) => /finding\s*aid/i.test(line)) ??
    lines.find((line) => /finding\s*aid/i.test(line)) ??
    bulletLines[0] ??
    lines[0] ??
    '';
  const normalizedCatalog =
    bulletLines.find((line) => /catalog/i.test(line)) ??
    lines.find((line) => /catalog/i.test(line)) ??
    bulletLines[1] ??
    lines[1] ??
    '';

  if (!normalizedFindingAid && !normalizedCatalog) {
    return fallbackSnapshotSummary(source);
  }

  const findingAidLine = normalizeSummaryLine(normalizedFindingAid || 'No direct changes detected.', 'Finding Aid');
  const catalogLine = normalizeSummaryLine(normalizedCatalog || 'No direct changes detected.', 'Catalog');
  const normalized = `${findingAidLine}\n${catalogLine}`;

  if (normalized.length <= 520) {
    return normalized;
  }
  return `${findingAidLine.slice(0, 250)}\n${catalogLine.slice(0, 250)}`;
}

function fallbackSummaryFromDiff(args: {
  source: string;
  diff: SnapshotDiffPayload;
}): string {
  const { diff, source } = args;
  const findingAid =
    source === 'revert' && diff.revertedFromSnapshotId != null
      ? `- **Finding Aid:** Reverted from revision ${diff.revertedFromSnapshotId}; ${diff.stats.updatedNodeCount} nodes updated.`
      : `- **Finding Aid:** ${diff.stats.addedNodeCount} added, ${diff.stats.removedNodeCount} removed, ${diff.stats.updatedNodeCount} updated nodes.`;
  const catalog = `- **Catalog:** ${diff.stats.catalogFieldChangeCount} catalog fields changed across ${diff.stats.textSectionChangeCount} text sections.`;
  return `${findingAid}\n${catalog}`;
}

async function generateSnapshotSummary(args: {
  source: string;
  diff: SnapshotDiffPayload;
}): Promise<string> {
  if (!geminiApiKey) {
    return fallbackSummaryFromDiff(args);
  }

  const promptPayload = {
    source: args.source,
    documentName: args.diff.documentName,
    currentSnapshotId: args.diff.currentSnapshotId,
    previousSnapshotId: args.diff.previousSnapshotId,
    revertedFromSnapshotId: args.diff.revertedFromSnapshotId,
    stats: args.diff.stats,
    nodeChanges: args.diff.nodeChanges,
    catalogChanges: {
      changedFields: args.diff.catalogChanges.changedFields.slice(0, 40),
    },
    wordChanges: {
      sections: args.diff.wordChanges.sections.slice(0, 8),
    },
  };

  const prompt = [
    'You summarize finding-aid revision snapshots for archivists.',
    'Return markdown with exactly two bullet lines and nothing else.',
    '- **Finding Aid:** <ultra-brief change summary>',
    '- **Catalog:** <ultra-brief metadata/catalog summary>',
    'Each summary should be concrete and specific, about 8-20 words.',
    'If no clear change for a line, write "No direct changes detected."',
    `diff_payload=${JSON.stringify(promptPayload)}`,
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            topP: 0.9,
            maxOutputTokens: 48,
            responseMimeType: 'text/plain',
          },
        }),
      },
    );

    if (!response.ok) {
      return fallbackSummaryFromDiff(args);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n').trim() ?? '';
    return cleanSnapshotSummary(text, args.source);
  } catch {
    return fallbackSummaryFromDiff(args);
  }
}

async function loadDocument(documentName: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const filePath = roomFilePath(documentName);

  try {
    const buffer = await fs.readFile(filePath);
    Y.applyUpdate(doc, new Uint8Array(buffer));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  return doc;
}

async function storeDocument(documentName: string, doc: Y.Doc): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const update = Y.encodeStateAsUpdate(doc);
  await fs.writeFile(roomFilePath(documentName), Buffer.from(update));
}

async function ensurePostgresPersistence(pool: Pool, schema: string): Promise<void> {
  const quotedSchema = quoteIdentifier(schema);
  const documentsTable = `${quotedSchema}.${quoteIdentifier(postgresDocumentsTable)}`;
  const snapshotsTable = `${quotedSchema}.${quoteIdentifier(postgresSnapshotsTable)}`;
  const updatesTable = `${quotedSchema}.${quoteIdentifier(postgresUpdatesTable)}`;

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${documentsTable} (
      document_name TEXT PRIMARY KEY,
      org_id TEXT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${snapshotsTable} (
      id BIGSERIAL PRIMARY KEY,
      document_name TEXT NOT NULL,
      org_id TEXT NULL,
      actor_id TEXT NULL,
      actor_type TEXT NULL,
      request_id TEXT NULL,
      source TEXT NOT NULL DEFAULT 'store',
      summary TEXT NULL,
      reverted_from_snapshot_id BIGINT NULL,
      previous_snapshot_id BIGINT NULL,
      diff_status TEXT NOT NULL DEFAULT 'done',
      diff_json JSONB NULL,
      diff_error TEXT NULL,
      state BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE ${snapshotsTable} ADD COLUMN IF NOT EXISTS summary TEXT NULL`);
  await pool.query(`ALTER TABLE ${snapshotsTable} ADD COLUMN IF NOT EXISTS reverted_from_snapshot_id BIGINT NULL`);
  await pool.query(`ALTER TABLE ${snapshotsTable} ADD COLUMN IF NOT EXISTS previous_snapshot_id BIGINT NULL`);
  await pool.query(`ALTER TABLE ${snapshotsTable} ADD COLUMN IF NOT EXISTS diff_status TEXT NOT NULL DEFAULT 'done'`);
  await pool.query(`ALTER TABLE ${snapshotsTable} ADD COLUMN IF NOT EXISTS diff_json JSONB NULL`);
  await pool.query(`ALTER TABLE ${snapshotsTable} ADD COLUMN IF NOT EXISTS diff_error TEXT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${updatesTable} (
      id BIGSERIAL PRIMARY KEY,
      document_name TEXT NOT NULL,
      org_id TEXT NULL,
      actor_id TEXT NULL,
      actor_type TEXT NULL,
      request_id TEXT NULL,
      update BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier('collab_documents_org_idx')} ON ${documentsTable} (org_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier('collab_documents_updated_idx')} ON ${documentsTable} (updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier('collab_snapshots_doc_created_idx')} ON ${snapshotsTable} (document_name, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier('collab_snapshots_diff_status_idx')} ON ${snapshotsTable} (diff_status, created_at ASC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier('collab_updates_doc_created_idx')} ON ${updatesTable} (document_name, created_at DESC)`);
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '*';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return null;
  }

  return JSON.parse(raw);
}

async function waitFor(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimNextSnapshotDiffJob(pool: Pool, snapshotsTable: string): Promise<SnapshotDiffJobRow | null> {
  const result = await pool.query<SnapshotDiffJobRow>(
    `
      WITH candidate AS (
        SELECT id
        FROM ${snapshotsTable}
        WHERE diff_status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${snapshotsTable} AS snapshots
      SET diff_status = 'processing', diff_error = NULL
      FROM candidate
      WHERE snapshots.id = candidate.id
      RETURNING
        snapshots.id,
        snapshots.document_name,
        snapshots.source,
        snapshots.state,
        snapshots.previous_snapshot_id,
        snapshots.reverted_from_snapshot_id
    `,
  );

  if (!result.rowCount) {
    return null;
  }
  return result.rows[0] ?? null;
}

async function processSnapshotDiffJob(pool: Pool, snapshotsTable: string, job: SnapshotDiffJobRow): Promise<void> {
  try {
    let previousState: Uint8Array | null = null;
    if (job.previous_snapshot_id != null) {
      const previousResult = await pool.query<{ state: Buffer }>(
        `
          SELECT state
          FROM ${snapshotsTable}
          WHERE id = $1
          LIMIT 1
        `,
        [job.previous_snapshot_id],
      );
      if (previousResult.rowCount && previousResult.rows[0]?.state) {
        previousState = new Uint8Array(previousResult.rows[0].state);
      }
    }

    const currentState = new Uint8Array(job.state);
    const diffPayload = buildSnapshotDiffPayload({
      documentName: job.document_name,
      source: job.source,
      currentSnapshotId: job.id,
      previousSnapshotId: job.previous_snapshot_id,
      revertedFromSnapshotId: job.reverted_from_snapshot_id,
      previousState,
      currentState,
    });

    let summary = await generateSnapshotSummary({
      source: job.source,
      diff: diffPayload,
    });
    if (job.source === 'revert' && job.reverted_from_snapshot_id != null) {
      summary = withRevertTag(summary, job.reverted_from_snapshot_id);
    }

    await pool.query(
      `
        UPDATE ${snapshotsTable}
        SET diff_status = 'done', diff_json = $2::jsonb, summary = $3, diff_error = NULL
        WHERE id = $1
      `,
      [job.id, JSON.stringify(diffPayload), summary],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown diff worker error';
    await pool.query(
      `
        UPDATE ${snapshotsTable}
        SET diff_status = 'failed', diff_error = $2
        WHERE id = $1
      `,
      [job.id, truncateText(message, 1000)],
    );
  }
}

function startSnapshotDiffWorker(args: {
  pool: Pool;
  snapshotsTable: string;
  intervalMs: number;
  maxJobsPerTick: number;
}): () => void {
  let closed = false;
  let running = false;

  const tick = async () => {
    if (closed || running) {
      return;
    }
    running = true;
    try {
      for (let index = 0; index < args.maxJobsPerTick; index += 1) {
        const job = await claimNextSnapshotDiffJob(args.pool, args.snapshotsTable);
        if (!job) {
          break;
        }
        await processSnapshotDiffJob(args.pool, args.snapshotsTable, job);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, args.intervalMs);
  void tick();

  return () => {
    closed = true;
    clearInterval(timer);
  };
}

async function main(): Promise<void> {
  const persistenceMode = postgresConnectionString.length > 0 ? 'postgres' : 'filesystem';
  let postgresPool: Pool | null = null;
  let documentsTable = '';
  let snapshotsTable = '';
  let updatesTable = '';
  let stopDiffWorker: (() => void) | null = null;
  const lastSnapshotAtByDoc = new Map<string, number>();

  if (persistenceMode === 'postgres') {
    postgresPool = new Pool({
      connectionString: postgresConnectionString,
    });
    await ensurePostgresPersistence(postgresPool, postgresSchema);
    const quotedSchema = quoteIdentifier(postgresSchema);
    documentsTable = `${quotedSchema}.${quoteIdentifier(postgresDocumentsTable)}`;
    snapshotsTable = `${quotedSchema}.${quoteIdentifier(postgresSnapshotsTable)}`;
    updatesTable = `${quotedSchema}.${quoteIdentifier(postgresUpdatesTable)}`;
  } else {
    await fs.mkdir(dataDir, { recursive: true });
  }

  const server = Server.configure({
    port,
    address: host,
    ...(postgresPool
      ? {
          extensions: [
            new Database({
              fetch: async ({ documentName }) => {
                const result = await postgresPool.query<{ data: Buffer }>(
                  `SELECT data FROM ${documentsTable} WHERE document_name = $1`,
                  [documentName],
                );
                if (!result.rowCount) {
                  return null;
                }
                const row = result.rows[0];
                if (!row?.data) {
                  return null;
                }
                return new Uint8Array(row.data);
              },
              store: async ({ documentName, state, context }) => {
                const orgId = orgIdFromRoom(documentName);
                const actorId = typeof context?.user?.id === 'string' ? context.user.id : null;
                const actorType = typeof context?.actorType === 'string' ? context.actorType : 'human';
                const requestId = typeof context?.requestId === 'string' ? context.requestId : null;
                await postgresPool.query(
                  `
                    INSERT INTO ${documentsTable} (document_name, org_id, data, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (document_name)
                    DO UPDATE SET org_id = EXCLUDED.org_id, data = EXCLUDED.data, updated_at = NOW()
                  `,
                  [documentName, orgId, Buffer.from(state)],
                );

                const now = Date.now();
                const previousSnapshotAt = lastSnapshotAtByDoc.get(documentName) ?? 0;
                const shouldCreateSnapshot = now - previousSnapshotAt >= Math.max(1000, snapshotIntervalMs);
                if (shouldCreateSnapshot) {
                  const previousSnapshot = await postgresPool.query<{ id: number }>(
                    `
                      SELECT id
                      FROM ${snapshotsTable}
                      WHERE document_name = $1
                      ORDER BY created_at DESC
                      LIMIT 1
                    `,
                    [documentName],
                  );
                  const previousSnapshotId = previousSnapshot.rowCount ? (previousSnapshot.rows[0]?.id ?? null) : null;

                  await postgresPool.query(
                    `
                      INSERT INTO ${snapshotsTable}
                        (document_name, org_id, actor_id, actor_type, request_id, source, summary, reverted_from_snapshot_id, previous_snapshot_id, diff_status, diff_json, diff_error, state, created_at)
                      VALUES ($1, $2, $3, $4, $5, 'store', NULL, NULL, $6, 'pending', NULL, NULL, $7, NOW())
                    `,
                    [documentName, orgId, actorId, actorType, requestId, previousSnapshotId, Buffer.from(state)],
                  );
                  lastSnapshotAtByDoc.set(documentName, now);
                }
              },
            }),
          ],
          async onChange(data) {
            const orgId = orgIdFromRoom(data.documentName);
            const actorId = typeof data.context?.user?.id === 'string' ? data.context.user.id : null;
            const actorType = typeof data.context?.actorType === 'string' ? data.context.actorType : 'human';
            const requestId = typeof data.context?.requestId === 'string' ? data.context.requestId : null;
            await postgresPool.query(
              `
                INSERT INTO ${updatesTable}
                  (document_name, org_id, actor_id, actor_type, request_id, update, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
              `,
              [data.documentName, orgId, actorId, actorType, requestId, Buffer.from(data.update)],
            );
          },
        }
      : {
          async onLoadDocument(data) {
            return loadDocument(data.documentName);
          },
          async onStoreDocument(data) {
            await storeDocument(data.documentName, data.document);
          },
        }),
    async onAuthenticate(data) {
      const room = parseRoomName(data.documentName);
      if (!room) {
        throw new Error('Invalid room name');
      }

      if (!jwtSecret && !fallbackStaticToken) {
        return;
      }

      const rawToken = extractBearerToken(data.token, data.request as { headers?: Record<string, unknown> } | undefined);
      if (!rawToken) {
        throw new Error('Missing auth token');
      }

      const tokenContext = authenticateToken(rawToken);
      ensureRoomAccess(data.documentName, tokenContext);

      return {
        user: {
          id: tokenContext.subject,
          org: tokenContext.org ?? undefined,
        },
        actorType: tokenContext.actorType,
        requestId: tokenContext.requestId,
      };
    },
    async onRequest(payload) {
      const { request, response, instance } = payload;
      const method = (request.method ?? 'GET').toUpperCase();
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (!url.pathname.startsWith('/history')) {
        return;
      }

      setCorsHeaders(request, response);
      if (method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        throw null;
      }

      if (!postgresPool) {
        sendJson(response, 503, { error: 'History APIs require Postgres persistence.' });
        throw null;
      }

      const rawToken = extractBearerToken(null, request as unknown as { headers?: Record<string, unknown> });
      if (!rawToken) {
        sendJson(response, 401, { error: 'Missing auth token.' });
        throw null;
      }

      let tokenContext: TokenContext;
      try {
        tokenContext = authenticateToken(rawToken);
      } catch (error) {
        sendJson(response, 401, { error: (error as Error).message });
        throw null;
      }

      if (method === 'GET' && url.pathname === '/history/snapshots') {
        const documentName = String(url.searchParams.get('documentName') ?? '').trim();
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 30) || 30));
        if (!documentName) {
          sendJson(response, 400, { error: 'documentName is required.' });
          throw null;
        }

        try {
          ensureRoomAccess(documentName, tokenContext);
        } catch (error) {
          sendJson(response, 403, { error: (error as Error).message });
          throw null;
        }

        const rows = await postgresPool.query<HistorySnapshotRow>(
          `
            SELECT id, created_at, actor_id, actor_type, request_id, source, summary, reverted_from_snapshot_id, previous_snapshot_id, diff_status, diff_error
            FROM ${snapshotsTable}
            WHERE document_name = $1
            ORDER BY created_at DESC
            LIMIT $2
          `,
          [documentName, limit],
        );

        sendJson(response, 200, {
          documentName,
          snapshots: rows.rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at.toISOString(),
            actorId: row.actor_id,
            actorType: row.actor_type,
            requestId: row.request_id,
            source: row.source,
            summary: row.summary,
            revertedFromSnapshotId: row.reverted_from_snapshot_id,
            previousSnapshotId: row.previous_snapshot_id,
            diffStatus: row.diff_status,
            diffError: row.diff_error,
          })),
        });
        throw null;
      }

      if (method === 'GET' && url.pathname === '/history/series-refs') {
        const collectionId = String(url.searchParams.get('collectionId') ?? '').trim();
        if (!collectionId) {
          sendJson(response, 400, { error: 'collectionId is required.' });
          throw null;
        }

        if (!tokenContext.org) {
          sendJson(response, 403, { error: 'Token missing org claim.' });
          throw null;
        }

        const canonicalPattern = `series:${tokenContext.org}:${collectionId}:%`;
        const legacyPattern = `series:${collectionId}:%`;

        const rows = await postgresPool.query<{ document_name: string; data: Buffer; updated_at: Date }>(
          `
            SELECT document_name, data, updated_at
            FROM ${documentsTable}
            WHERE org_id = $1
              AND (
                document_name LIKE $2
                OR document_name LIKE $3
              )
            ORDER BY updated_at DESC
            LIMIT 500
          `,
          [tokenContext.org, canonicalPattern, legacyPattern],
        );

        const deduped = new Map<string, SeriesRefCandidate>();
        for (const row of rows.rows) {
          const candidate = extractSeriesRefCandidateFromDoc({
            documentName: row.document_name,
            data: row.data,
            updatedAt: row.updated_at,
          });
          if (!candidate) {
            continue;
          }
          if (candidate.sourceLevel && candidate.sourceLevel !== 'series') {
            continue;
          }
          const dedupeKey = candidate.title.toLocaleLowerCase();
          if (deduped.has(dedupeKey)) {
            continue;
          }
          deduped.set(dedupeKey, candidate);
        }

        const refs = Array.from(deduped.values()).map((candidate, index) => ({
          docName: candidate.docName,
          seriesId: candidate.seriesId,
          title: candidate.title,
          order: index + 1,
          sourceLevel: candidate.sourceLevel,
          updatedAt: candidate.updatedAt.toISOString(),
        }));

        sendJson(response, 200, {
          collectionId,
          refs,
        });
        throw null;
      }

      if (method === 'POST' && url.pathname === '/history/revert') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch {
          sendJson(response, 400, { error: 'Invalid JSON body.' });
          throw null;
        }

        const documentName =
          body && typeof body === 'object' && typeof (body as Record<string, unknown>).documentName === 'string'
            ? String((body as Record<string, unknown>).documentName).trim()
            : '';
        const snapshotIdRaw =
          body && typeof body === 'object' ? (body as Record<string, unknown>).snapshotId : null;
        const snapshotId = typeof snapshotIdRaw === 'number' ? snapshotIdRaw : Number(snapshotIdRaw);

        if (!documentName || !Number.isFinite(snapshotId) || snapshotId <= 0) {
          sendJson(response, 400, { error: 'documentName and snapshotId are required.' });
          throw null;
        }

        try {
          ensureRoomAccess(documentName, tokenContext);
        } catch (error) {
          sendJson(response, 403, { error: (error as Error).message });
          throw null;
        }

        const snapshotResult = await postgresPool.query<{ state: Buffer; org_id: string | null }>(
          `
            SELECT state, org_id
            FROM ${snapshotsTable}
            WHERE id = $1 AND document_name = $2
            LIMIT 1
          `,
          [snapshotId, documentName],
        );
        if (!snapshotResult.rowCount || !snapshotResult.rows[0]?.state) {
          sendJson(response, 404, { error: 'Snapshot not found.' });
          throw null;
        }

        const row = snapshotResult.rows[0];
        const orgId = row.org_id ?? orgIdFromRoom(documentName);
        const previousSnapshot = await postgresPool.query<{ id: number }>(
          `
            SELECT id
            FROM ${snapshotsTable}
            WHERE document_name = $1
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [documentName],
        );
        const previousSnapshotId = previousSnapshot.rowCount ? (previousSnapshot.rows[0]?.id ?? null) : null;
        const summary = withRevertTag(fallbackSnapshotSummary('revert'), snapshotId);

        await postgresPool.query('BEGIN');
        try {
          await postgresPool.query(
            `
              INSERT INTO ${documentsTable} (document_name, org_id, data, updated_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (document_name)
              DO UPDATE SET org_id = EXCLUDED.org_id, data = EXCLUDED.data, updated_at = NOW()
            `,
            [documentName, orgId, row.state],
          );

          await postgresPool.query(
            `
              INSERT INTO ${snapshotsTable}
                (document_name, org_id, actor_id, actor_type, request_id, source, summary, reverted_from_snapshot_id, previous_snapshot_id, diff_status, diff_json, diff_error, state, created_at)
              VALUES ($1, $2, $3, $4, $5, 'revert', $6, $7, $8, 'pending', NULL, NULL, $9, NOW())
            `,
            [documentName, orgId, tokenContext.subject, tokenContext.actorType, tokenContext.requestId, summary, snapshotId, previousSnapshotId, row.state],
          );

          await postgresPool.query('COMMIT');
        } catch (error) {
          await postgresPool.query('ROLLBACK');
          throw error;
        }

        const liveDocument = instance.documents.get(documentName);
        let disconnectedClients = 0;
        let unloadedFromMemory = false;
        if (liveDocument) {
          for (const connection of liveDocument.getConnections()) {
            disconnectedClients += 1;
            try {
              connection.webSocket.close(1012, 'Document reverted to snapshot');
            } catch {
              connection.close();
            }
          }

          // Wait briefly for disconnect bookkeeping, then evict the room from memory
          // so the next sync loads reverted state from Postgres.
          for (let attempt = 0; attempt < 8; attempt += 1) {
            if (liveDocument.getConnectionsCount() === 0) {
              break;
            }
            await waitFor(50);
          }

          await instance.unloadDocument(liveDocument);
          unloadedFromMemory = !instance.documents.has(documentName);
        }

        sendJson(response, 200, {
          ok: true,
          documentName,
          snapshotId,
          reconnectRequired: disconnectedClients > 0,
          disconnectedClients,
          unloadedFromMemory,
        });
        throw null;
      }

      sendJson(response, 404, { error: 'Not found.' });
      throw null;
    },
    async onConnect(data) {
      const org = (data.context as { user?: { org?: string } } | undefined)?.user?.org ?? 'unknown';
      console.log(`[hocuspocus] connect document=${data.documentName} org=${org}`);
    },
    async onDisconnect(data) {
      const org = (data.context as { user?: { org?: string } } | undefined)?.user?.org ?? 'unknown';
      console.log(`[hocuspocus] disconnect document=${data.documentName} org=${org}`);
    },
  });

  await server.listen();
  if (persistenceMode === 'postgres' && postgresPool && diffWorkerEnabled) {
    stopDiffWorker = startSnapshotDiffWorker({
      pool: postgresPool,
      snapshotsTable,
      intervalMs: diffWorkerIntervalMs,
      maxJobsPerTick: diffWorkerMaxJobsPerTick,
    });
  }
  console.log(`[hocuspocus] listening on ws://${host}:${port}`);
  if (persistenceMode === 'postgres') {
    console.log(
      `[hocuspocus] persistence backend: postgres tables=${postgresSchema}.${postgresDocumentsTable}, ${postgresSchema}.${postgresSnapshotsTable}, ${postgresSchema}.${postgresUpdatesTable}`,
    );
    console.log(
      `[hocuspocus] diff worker: ${diffWorkerEnabled ? `enabled interval=${diffWorkerIntervalMs}ms maxJobs=${diffWorkerMaxJobsPerTick}` : 'disabled'}`,
    );
  } else {
    console.log(`[hocuspocus] persistence backend: filesystem dir=${dataDir}`);
  }

  const shutdown = () => {
    stopDiffWorker?.();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[hocuspocus] fatal error', error);
  process.exit(1);
});
