#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
HOCUSPOCUS_HOST="${HOCUSPOCUS_HOST:-127.0.0.1}"
HOCUSPOCUS_PORT="${HOCUSPOCUS_PORT:-1234}"
REQUIRE_BASIC_AUTH="${REQUIRE_BASIC_AUTH:-0}"
COLLAB_AUTH_TOKEN="${COLLAB_AUTH_TOKEN:-}"

if [[ "$REQUIRE_BASIC_AUTH" == "1" ]] && [[ -z "${BASIC_AUTH_USER:-}" || -z "${BASIC_AUTH_PASSWORD:-}" ]]; then
  echo "[entrypoint] REQUIRE_BASIC_AUTH=1 but BASIC_AUTH_USER/BASIC_AUTH_PASSWORD are missing"
  exit 1
fi

if [[ "$REQUIRE_BASIC_AUTH" == "1" ]] && [[ -z "${COLLAB_AUTH_TOKEN:-}" ]]; then
  echo "[entrypoint] REQUIRE_BASIC_AUTH=1 but COLLAB_AUTH_TOKEN is missing"
  exit 1
fi

if [[ -n "${BASIC_AUTH_USER:-}" || -n "${BASIC_AUTH_PASSWORD:-}" ]]; then
  if [[ -z "${BASIC_AUTH_USER:-}" || -z "${BASIC_AUTH_PASSWORD:-}" ]]; then
    echo "[entrypoint] BASIC_AUTH_USER and BASIC_AUTH_PASSWORD must both be set"
    exit 1
  fi

  htpasswd -bc /etc/nginx/.htpasswd_archival_editor "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD"
  AUTH_BLOCK=$'auth_basic "Restricted";\n    auth_basic_user_file /etc/nginx/.htpasswd_archival_editor;'
else
  AUTH_BLOCK=""
fi

export PORT HOCUSPOCUS_PORT AUTH_BLOCK COLLAB_AUTH_TOKEN
envsubst '${PORT} ${HOCUSPOCUS_PORT} ${AUTH_BLOCK} ${COLLAB_AUTH_TOKEN}' \
  < /app/deploy/cloud-run/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[entrypoint] starting Hocuspocus on ${HOCUSPOCUS_HOST}:${HOCUSPOCUS_PORT}"
HOCUSPOCUS_HOST="$HOCUSPOCUS_HOST" HOCUSPOCUS_PORT="$HOCUSPOCUS_PORT" npm run -w @archival/collab start &
COLLAB_PID=$!

cleanup() {
  if kill -0 "$COLLAB_PID" >/dev/null 2>&1; then
    kill "$COLLAB_PID" >/dev/null 2>&1 || true
    wait "$COLLAB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

nginx -g 'daemon off;'
