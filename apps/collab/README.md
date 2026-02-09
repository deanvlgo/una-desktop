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
