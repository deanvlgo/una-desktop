# Hocuspocus Collaboration Server

Local Y.js WebSocket server for the archival editor.

## Run

```bash
npm run -w @archival/collab dev
```

Default endpoint:

- `ws://127.0.0.1:1234`

## Environment

- `HOCUSPOCUS_PORT` (default: `1234`)
- `HOCUSPOCUS_HOST` (default: `127.0.0.1`)
- `HOCUSPOCUS_DATA_DIR` (default: `apps/collab/.hocuspocus-data`)
- `HOCUSPOCUS_DATABASE_URL` (optional): Postgres connection string for canonical doc persistence
- `HOCUSPOCUS_DB_SCHEMA` (optional, default: `collab`)
- `HOCUSPOCUS_DB_TABLE` (optional, default: `documents`)
- `HOCUSPOCUS_SNAPSHOTS_TABLE` (optional, default: `document_snapshots`)
- `HOCUSPOCUS_UPDATES_TABLE` (optional, default: `document_updates`)
- `HOCUSPOCUS_SNAPSHOT_INTERVAL_MS` (optional, default: `60000`)
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` (optional): enables Gemini-generated ultra-brief snapshot summaries
- `GEMINI_SNAPSHOT_MODEL` (optional, default: `gemini-2.5-flash-lite`)
- `HOCUSPOCUS_DIFF_WORKER_ENABLED` (optional, default: `1`): run in-process snapshot diff/summarize worker
- `HOCUSPOCUS_DIFF_WORKER_INTERVAL_MS` (optional, default: `2000`)
- `HOCUSPOCUS_DIFF_WORKER_MAX_JOBS` (optional, default: `1`)
- `JWT_SECRET_KEY` (preferred): validates Una JWTs and enforces org-scoped canonical rooms
- `COLLAB_AUTH_TOKEN` (optional fallback): static shared token for legacy/local use only

If `HOCUSPOCUS_DATABASE_URL` is set, the server uses Postgres persistence via `@hocuspocus/extension-database`
and stores:
- latest state in `collab.documents`
- periodic snapshots in `collab.document_snapshots` (with `summary`, `previous_snapshot_id`, `diff_status`, `diff_json`, `diff_error`)
- append-only Yjs updates in `collab.document_updates`

All schema/tables are auto-created on startup. This is the hybrid persistence model.
If it is not set, the server falls back to filesystem persistence.

## Snapshot APIs

When running with Postgres persistence, authenticated HTTP endpoints are available on the same host:

- `GET /history/snapshots?documentName=<room>&limit=30`
- `POST /history/revert` body: `{ "documentName": "...", "snapshotId": 123 }`

## Migrate Existing File Docs to Postgres

To import existing `.bin` file-backed docs into Postgres:

```bash
npm run -w @archival/collab migrate:file-to-postgres
```

This reads from `HOCUSPOCUS_DATA_DIR` (or default `apps/collab/.hocuspocus-data`) and upserts into
`HOCUSPOCUS_DB_SCHEMA.HOCUSPOCUS_DB_TABLE` (defaults to `collab.documents`).

## Web App Integration

The web app uses `VITE_HOCUSPOCUS_URL` when provided.

Default behavior:
- local dev (`localhost`): `ws://127.0.0.1:1234`
- non-local host: same-origin `/collab/`

To run the web app against this server:

```bash
VITE_HOCUSPOCUS_URL=ws://127.0.0.1:1234 npm run -w @archival/web dev
```

## Multi-User Smoke Test

Open two browser windows with different user names:

- `http://localhost:5173/?user=Alex`
- `http://localhost:5173/?user=Blair`

Optional: disable live collab in a window with `?collab=0`.

## Production Proxy

For a lightweight password-protected deployment behind Nginx, see:

- `docs/DEPLOY_NGINX.md`
- `docs/nginx/archival-editor.conf`

For single-container Cloud Run deployment (Docker + Nginx + Hocuspocus), see:

- `docs/DEPLOY_CLOUD_RUN_SINGLE_CONTAINER.md`
