# Una Collaborative Editor

## Run locally

From repo root:

```bash
npm ci
npm run --workspace apps/web dev
```

Optional realtime collaboration (second terminal):

```bash
npm run --workspace apps/collab dev
```

If collab server is running, open:

```text
http://localhost:5173/?collab=1
```

## Submit Cloud Build

From repo root:

```bash
gcloud builds submit --config cloudbuild.cloudrun.yaml \
  --substitutions=_REGION=us-central1,_SERVICE=una-editor
```
