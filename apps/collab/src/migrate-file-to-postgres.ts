import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const postgresConnectionString = String(
  process.env.HOCUSPOCUS_DATABASE_URL ?? process.env.HISTORIQ_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
).trim();
const postgresSchema = String(process.env.HOCUSPOCUS_DB_SCHEMA ?? 'collab').trim();
const postgresTable = String(process.env.HOCUSPOCUS_DB_TABLE ?? 'documents').trim();

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

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function decodeDocumentName(filename: string): string | null {
  if (!filename.endsWith('.bin')) {
    return null;
  }

  const encoded = filename.slice(0, -4);
  if (!encoded) {
    return null;
  }

  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

async function ensurePostgresPersistence(pool: Pool, schema: string, table: string): Promise<void> {
  const quotedSchema = quoteIdentifier(schema);
  const quotedTable = quoteIdentifier(table);
  const qualifiedTable = `${quotedSchema}.${quotedTable}`;
  const orgIndexName = quoteIdentifier(`${schema}_${table}_org_id_idx`);
  const updatedAtIndexName = quoteIdentifier(`${schema}_${table}_updated_at_idx`);

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable} (
      document_name TEXT PRIMARY KEY,
      org_id TEXT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${orgIndexName} ON ${qualifiedTable} (org_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${updatedAtIndexName} ON ${qualifiedTable} (updated_at DESC)`);
}

async function main(): Promise<void> {
  if (!postgresConnectionString) {
    throw new Error(
      'Missing Postgres connection string. Set HOCUSPOCUS_DATABASE_URL, HISTORIQ_DATABASE_URL, or DATABASE_URL.',
    );
  }

  const pool = new Pool({
    connectionString: postgresConnectionString,
  });
  const qualifiedTable = `${quoteIdentifier(postgresSchema)}.${quoteIdentifier(postgresTable)}`;

  try {
    await ensurePostgresPersistence(pool, postgresSchema, postgresTable);

    let entries: string[] = [];
    try {
      entries = await fs.readdir(dataDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.log(`[migrate] source directory not found: ${dataDir}`);
        return;
      }
      throw error;
    }

    const files = entries.filter((entry) => entry.endsWith('.bin')).sort();
    if (files.length === 0) {
      console.log(`[migrate] no .bin files found in ${dataDir}`);
      return;
    }

    let migrated = 0;
    let skipped = 0;

    for (const file of files) {
      const documentName = decodeDocumentName(file);
      if (!documentName) {
        skipped += 1;
        continue;
      }

      const filePath = path.join(dataDir, file);
      const data = await fs.readFile(filePath);
      if (data.length === 0) {
        skipped += 1;
        continue;
      }

      const parsed = parseRoomName(documentName);
      const orgId = parsed && 'orgId' in parsed ? parsed.orgId : null;

      await pool.query(
        `
          INSERT INTO ${qualifiedTable} (document_name, org_id, data, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (document_name)
          DO UPDATE SET org_id = EXCLUDED.org_id, data = EXCLUDED.data, updated_at = NOW()
        `,
        [documentName, orgId, data],
      );
      migrated += 1;
    }

    console.log(
      `[migrate] completed from ${dataDir} -> ${postgresSchema}.${postgresTable} (migrated=${migrated}, skipped=${skipped})`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[migrate] failed', error);
  process.exit(1);
});
