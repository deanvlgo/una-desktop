# Cloud Run Single-Container Deployment (Docker)

Yes, this app can run as a **single Cloud Run container**, similar to una-mobile's Cloud Run pattern.

This setup runs:
- Nginx on `$PORT` (Cloud Run ingress)
- Hocuspocus on `127.0.0.1:1234` inside the same container
- Web app static assets from `apps/web/dist`

## Files

- `Dockerfile`
- `deploy/cloud-run/entrypoint.sh`
- `deploy/cloud-run/nginx.conf.template`
- `cloudbuild.cloudrun.yaml`

## Why this works on Cloud Run

- Cloud Run requires one externally exposed port: Nginx listens on `$PORT`.
- Internal services are fine on localhost: Hocuspocus stays private behind Nginx.
- WebSocket support works through Nginx proxy at `/collab/`.

## 1. Local smoke test with Docker

```bash
docker build -t una-editor:local .
docker run --rm -p 8080:8080 una-editor:local
```

Open `http://localhost:8080`.

## 2. Create shared username/password secrets

Use Secret Manager so creds are not committed to source or plain env vars:

```bash
printf 'shared_editor_user' | gcloud secrets create una-editor-basic-auth-user --data-file=- || \
printf 'shared_editor_user' | gcloud secrets versions add una-editor-basic-auth-user --data-file=-

printf 'change-this-strong-password' | gcloud secrets create una-editor-basic-auth-password --data-file=- || \
printf 'change-this-strong-password' | gcloud secrets versions add una-editor-basic-auth-password --data-file=-
```

Grant the Cloud Run runtime service account access to those secrets:

```bash
SA_EMAIL="$(gcloud run services describe una-editor --region us-central1 --format='value(spec.template.spec.serviceAccountName)')"
if [ -z "$SA_EMAIL" ]; then
  PROJECT_ID="$(gcloud config get-value project)"
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

gcloud secrets add-iam-policy-binding una-editor-basic-auth-user \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding una-editor-basic-auth-password \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

## 3. Build + deploy with Cloud Build

```bash
gcloud builds submit --config cloudbuild.cloudrun.yaml \
  --substitutions _REGION=us-central1,_SERVICE=una-editor
```

This build config enables:
- `REQUIRE_BASIC_AUTH=1`
- Cloud Run secret injection for `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`

## 4. Map the service to editor.historiq.com

Create domain mapping:

```bash
gcloud beta run domain-mappings create \
  --service una-editor \
  --domain editor.historiq.com \
  --region us-central1
```

Get DNS records to add at your DNS provider:

```bash
gcloud beta run domain-mappings describe \
  --domain editor.historiq.com \
  --region us-central1 \
  --format='yaml(status.resourceRecords)'
```

After DNS propagation, Cloud Run provisions certs and serves on `https://editor.historiq.com`.

## 5. Access control options (without app auth)

Recommended for IP protection:
- For shared password access, Cloud Run must be `--allow-unauthenticated`, and Nginx Basic Auth becomes the gate.
- This config already does that and requires auth via `REQUIRE_BASIC_AUTH=1`.
- Nginx enforces Basic Auth on app routes and `/collab/`.

## 6. Frontend collab URL behavior

For Cloud Run single-container, the web app should connect to `/collab/` on same origin.
If you use a custom deployment path, set:

```bash
VITE_HOCUSPOCUS_URL=wss://YOUR_DOMAIN/collab/
```

at build time.

## Notes

- Cloud Run request timeout caps websocket session duration (set to 3600 seconds in config).
- This is a strong temporary perimeter, but still not a replacement for full app auth/authorization.
