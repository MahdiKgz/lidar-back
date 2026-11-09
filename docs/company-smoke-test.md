# Company smoke test

Run with Node 24 and pnpm. No PDAL installation is performed by these commands. Work on a test PostgreSQL database and MinIO bucket. Do not replace existing company volumes or credentials with the example environment.

## Backend

```bash
cd lidar-back
pnpm install --frozen-lockfile
# Copy .env.example to .env only if .env does not exist, then configure infrastructure.
pnpm build
pnpm typeorm migration:run -d src/database/data-source.ts
```

For PDAL installed directly on the company machine, set:

```dotenv
PDAL_MODE=native
PROCESSING_WORKER_ENABLED=true
PROCESSING_CONCURRENCY=1
PDAL_TIMEOUT_MS=3600000
```

The `pdal` executable must be in the PATH of the process running Node, including the service account or conda environment. `pnpm pdal:check` checks version and readers.las / writers.copc. If PDAL is instead supplied as a Docker image, use `PDAL_MODE=docker` and set the existing local `PDAL_DOCKER_IMAGE`. The backend never pulls an image.

```bash
pnpm pdal:check
pnpm start:prod
```

This runs API and worker together. For split processes, set `PROCESSING_WORKER_ENABLED=false` on the API and true on `pnpm start:worker`. Use the same database, Redis and bucket. Workers need disk space for both original and COPC plus PDAL workspace. Stop jobs gracefully before stopping infrastructure.

Confirm Swagger `/api/v1/docs`. In a second terminal:

```bash
SMOKE_API_URL=http://localhost:3000/api/v1 pnpm test:smoke /absolute/path/survey.laz
```

The script streams a real file, checks all part sizes, repeats Complete, waits for READY, checks committed metadata and LAS signatures via HTTP Range on both original and COPC. It prints no signed URLs. It retains the dataset for the browser check. Optional `SMOKE_DELETE=1` removes only its newly created dataset after success. Repeat with LAS and LAZ, then the 640 MiB fixture. Optional `SMOKE_ORIGIN=http://localhost:5173` checks storage origin response headers; it is not a substitute for the browser's actual preflight check.

## Frontend

```bash
cd ../lidar-front
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Vite proxies `/api` to localhost:3000. If the backend runs elsewhere, set `VITE_API_URL` before starting/building. If 5173 is occupied use `pnpm dev --port 5174`. Include the exact frontend origin in backend `CORS_ORIGIN` and MinIO `MINIO_API_CORS_ALLOW_ORIGIN` (or the storage administrator's CORS configuration); expose ETag, Content-Length, Content-Range and Accept-Ranges and allow PUT/GET/HEAD/OPTIONS and Range. Existing external storage may require restarting/configuring CORS separately.

In a browser with WebGL2:

1. Select the smoke dataset. Confirm visible, correctly located points and fitted bounds; zoom and pan to verify additional Range requests, point size and visibility.
2. Upload a real file from the UI. Confirm byte progress, pause and resume.
3. Refresh during an incomplete upload, reselect the same file and resume; valid stored parts must not be resent.
4. Confirm QUEUED/PROCESSING then READY and automatic viewer activation.
5. Verify corrupt input becomes FAILED with an error; requeue a completed failed upload; cancel an incomplete upload; delete a test dataset.
6. In isolated test infrastructure, interrupt Redis during Complete and confirm processingEnqueuePending and recovery after Redis returns. Do not stop shared company Redis for this test.

A PASS from the CLI proves the actual server conversion path. Browser rendering and browser CORS must also pass before signing off the complete product. Record PDAL version, LAS/LAZ fixture, browser version, dataset ID and observed result; avoid copying signed URLs into reports.

## Docker temporary-directory compatibility

Some Docker installations (including sandboxed/snap daemons) cannot bind-mount the application's `/tmp`. Set `TMPDIR` to an existing absolute directory shared with Docker before running the application/checks, e.g. create `.tmp` inside the checkout and export `TMPDIR="$PWD/.tmp"`. Keep it writable by the Node process. Native PDAL does not need a Docker bind mount.

Real PDAL integration: `pnpm test:pdal-integration` generates a small valid georeferenced LAZ fixture with PDAL and exercises the actual queue/worker/storage/COPC path in disposable infrastructure. Use `FIXTURE_FORMAT=LAS` for LAS. Images must already be local.
