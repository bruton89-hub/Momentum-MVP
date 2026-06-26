# Momentum video renderer

This Cloud Run service preserves the uploaded original and writes an edited MP4
containing trim, optional built-in music, and optional burned-in text.

## Required values

Set these shell variables before deploying:

```sh
export PROJECT_ID="your-firebase-project-id"
export REGION="us-central1"
export REPOSITORY="momentum"
export SERVICE="momentum-video-renderer"
export RUNTIME_SERVICE_ACCOUNT="momentum-video-renderer@${PROJECT_ID}.iam.gserviceaccount.com"
export STORAGE_BUCKET="your-project.firebasestorage.app"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:$(git rev-parse --short HEAD)"
```

Use the exact Firebase Storage bucket shown in Firebase Console → Storage. Older
projects may use `${PROJECT_ID}.appspot.com`; newer projects commonly use
`${PROJECT_ID}.firebasestorage.app`.

## One-time project setup

```sh
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com

gcloud artifacts repositories describe "$REPOSITORY" \
  --location "$REGION" \
  >/dev/null 2>&1 || \
gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format docker \
  --location "$REGION" \
  --description "Momentum application containers"

gcloud iam service-accounts describe "$RUNTIME_SERVICE_ACCOUNT" \
  >/dev/null 2>&1 || \
gcloud iam service-accounts create momentum-video-renderer \
  --display-name "Momentum video renderer"

gcloud storage buckets add-iam-policy-binding "gs://${STORAGE_BUCKET}" \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role "roles/storage.objectViewer"

gcloud storage buckets add-iam-policy-binding "gs://${STORAGE_BUCKET}" \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role "roles/storage.objectCreator"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

The deployer must also have permission to push to the Artifact Registry
repository, deploy Cloud Run revisions, and attach the runtime service account.
Typical roles are:

- `roles/artifactregistry.writer` on the repository
- `roles/run.developer` on the Cloud Run service or project
- `roles/iam.serviceAccountUser` on the runtime service account

Creating repositories, service accounts, APIs, and IAM bindings requires
additional administrative permission for those one-time setup operations.

## Build and deploy

Run from the repository root so the Docker build can include `assets/audio`:

```sh
docker build \
  -f video-renderer/Dockerfile \
  -t "$IMAGE" \
  .

docker push "$IMAGE"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$RUNTIME_SERVICE_ACCOUNT" \
  --memory 2Gi \
  --cpu 2 \
  --concurrency 1 \
  --timeout 300 \
  --max-instances 10 \
  --set-env-vars "FIREBASE_CONFIG={\"storageBucket\":\"${STORAGE_BUCKET}\"}" \
  --allow-unauthenticated
```

`--allow-unauthenticated` is required because mobile/web clients send Firebase
ID tokens, not Google Cloud IAM identity tokens. The service itself verifies
the Firebase ID token and only permits a user to render files under their own
`posts/{uid}/` Storage prefix.

Get the deployed URL and verify the health endpoint:

```sh
export RENDERER_URL="$(
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format 'value(status.url)'
)"

curl --fail --silent --show-error "${RENDERER_URL}/health"
```

Expected response:

```json
{"ok":true}
```

## App configuration

Set the public renderer URL in the app environment:

```sh
EXPO_PUBLIC_VIDEO_RENDERER_URL=https://YOUR_CLOUD_RUN_SERVICE_URL
```

For local development, place it in the uncommitted repository-root `.env`
file. For EAS builds, configure it in the EAS environment used by the build,
for example:

```sh
eas env:create \
  --name EXPO_PUBLIC_VIDEO_RENDERER_URL \
  --value "$RENDERER_URL" \
  --environment preview \
  --visibility plaintext
```

Repeat for `production` when promoting the renderer. Restart Expo after changing
the local `.env`; rebuild the native app after changing build-time environment
variables.

## Rollback

List revisions:

```sh
gcloud run revisions list \
  --service "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION"
```

Send all traffic to the last known-good revision:

```sh
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions "KNOWN_GOOD_REVISION=100"
```

If no renderer revision is safe, remove
`EXPO_PUBLIC_VIDEO_RENDERER_URL` from the affected app environment and ship a
build/configuration that disables edited posting. Existing unedited uploads and
already-rendered posts remain valid.

## Secrets

Do not commit:

- `.env` or `.env.*` files other than `.env.example`
- Google service-account JSON keys
- `GOOGLE_APPLICATION_CREDENTIALS` files
- `GoogleService-Info.plist`
- `google-services.json`
- Firebase CLI debug logs or generated backup files

Cloud Run uses its attached service account through Application Default
Credentials. No service-account key file should be copied into the image or
configured as an app environment variable.
