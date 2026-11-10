# Current backend status (2026-11-08)

The upload and Dataset APIs are implemented and documented in `docs/openapi.json`. Swagger UI is `/api/v1/docs`. The sections below retain the initial processing audit context; this status supersedes their old follow-up list.

Implemented Dataset endpoints: GET `/datasets`, `/:id`, `/:id/status`, `/:id/download`, `/:id/copc`; POST `/:id/requeue`; DELETE `/:id`. Lists support page/limit, status, format, literal filename search, allowlisted sorting and stable UUID tie-breaking. Downloads expire after five minutes.

Upload mutations and deletion use the same PostgreSQL advisory lock as processing. Complete validates part numbers, ETags and exact sizes and recovers storage completion after DB commit failure. Resume returns actual sizes and a `valid` flag. Expiration cleanup runs every 30 seconds. Bucket lifecycle configuration covers orphan multipart uploads when supported/enabled.

Processing reconciliation runs every 15 seconds. UPLOADED is the durable enqueue intent, so Redis failures return `processingEnqueuePending` and are retried. Retained failed jobs are retried through explicit requeue with reset attempt counters. Deletion persists DELETING before external cleanup; a 30-second reconciler retries partial failures. This adds a status value to the existing varchar column without changing its schema. The new migration indexes active upload expiration and is applied by integration tests.

`pnpm test:integration` uses temporary isolated Docker containers with locally available images and cleans them up. `pnpm test:large-upload` runs the same flow with 671,811,028 synthetic bytes (41 parts), without PDAL. It verifies migrations, real upload/storage, duplicate complete, Redis enqueue, Dataset API, Range access and deletion. No existing databases/buckets are used. No images are pulled. For an existing PDAL runtime, `pnpm pdal:check` checks version and drivers without installing anything.

`PDAL_MODE=native` runs an already installed `pdal` binary. `PDAL_MODE=docker` uses a local image with pulls disabled. `PROCESSING_WORKER_ENABLED=false` disables job consumption on API instances; `pnpm start:worker` starts the application context without HTTP. Set worker concurrency with `PROCESSING_CONCURRENCY` (default 1). For production, provide a worker environment with Node and PDAL installed and use native mode, without a Docker socket. That deployment image and real PDAL execution have not been validated here.

Compose infrastructure now uses pinned image digests and community MinIO, which does not require the old license file. Review storage volumes before changing an existing deployment. MinIO browser origins are set by `MINIO_API_CORS_ALLOW_ORIGIN`. Optional `MINIO_CONFIGURE_BUCKET=true` applies S3 bucket CORS and orphan-upload lifecycle rules for services that support those APIs; otherwise configure lifecycle with your storage administrator. The default is false.

Remaining acceptance checks: real LAS and LAZ conversion, corrupted/unknown-CRS runtime fixtures, full upload-to-READY integration with PDAL, real browser CORS verification, Redis outage/restart and multi-instance stress testing. The large-file transfer test passed; it does not certify COPC conversion. No PDAL installation was performed in this continuation.

---

# LiDAR Backend

NestJS 12 / TypeScript ESM backend using PostgreSQL (TypeORM migrations), MinIO (S3), Redis / BullMQ and a Docker-based PDAL integration. This repository contains no frontend implementation.

## Setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Configure database, storage and Redis values in .env.
pnpm build
pnpm typeorm migration:run -d src/database/data-source.ts
pnpm start:dev
```

For production, `pnpm build && pnpm start:prod`. `synchronize` is disabled. No schema changes or new migrations were needed for this processing step.

The existing `infra/docker/compose.yaml` is a development starting point. Its MinIO service requires a separately supplied license file. It uses mutable image tags and is not a reproducible production deployment yet. Do not point development tests at production infrastructure.

## Swagger and API contract

With the default `API_PREFIX=api/v1` and port 3000:

- Swagger UI: `http://localhost:3000/api/v1/docs`
- OpenAPI JSON: `http://localhost:3000/api/v1/openapi.json`
- Committed contract: [docs/openapi.json](docs/openapi.json)
- Regenerate without infrastructure: `pnpm docs:generate`

| Method | Path (under `/api/v1`) | Purpose |
| --- | --- | --- |
| POST | `/uploads/initiate` | Create dataset and multipart upload |
| POST | `/uploads/:uploadSessionId/parts/presign` | Sign selected parts |
| GET | `/uploads/:uploadSessionId/parts` | List uploaded parts for resume |
| POST | `/uploads/:uploadSessionId/complete` | Complete upload and enqueue processing |
| DELETE | `/uploads/:uploadSessionId` | Abort upload |

The Dataset controller still contains generated scaffolding and is excluded from Swagger until B5. Those routes must not be treated as an implemented API.

Upload binary parts directly to MinIO using the presigned PUT URLs. Files must be LAS/LAZ and at most 1 GiB; parts are 16 MiB except the final part. Each presign request accepts at most 100 distinct part numbers. Presigned URLs last 900 seconds and sessions last 24 hours. The API never proxies the original file. `fileSize` in responses is a decimal string for PostgreSQL `bigint` compatibility.

Browser uploads require MinIO to allow the browser origin, PUT and appropriate request headers and expose `ETag`. COPC viewers will also need GET/HEAD and Range access. The API's CORS configuration does not configure MinIO; browser CORS / Range verification remains in B1/B5.

## Processing

`complete` enqueues `process-dataset` on `lidar-processing` with a stable dataset job ID, three attempts, exponential backoff (5 seconds), and bounded retention. The registered `WorkerHost` uses concurrency 1 per process and a PostgreSQL session advisory lock per dataset. The lock holds one database connection throughout processing, so leave database pool capacity for repository operations and other requests.

The worker streams the original to an isolated temporary directory, verifies its size, inspects it, converts it to COPC, checks the LAS 1.4 COPC info VLR, re-inspects it and compares point counts. It uploads the output to `datasets/{id}/processed/cloud.copc.laz` and checks the stored size before committing `metadata.lidar` and `READY` together. Metadata keeps both inspections, the output key, size and processing timestamp.

A dataset already marked READY is skipped on redelivery. Retries overwrite the same output key; a valid object uploaded before a database failure can safely be replaced by a subsequent attempt. Failures before the final attempt return the status to QUEUED; final failures set FAILED and a sanitized stage error. Temporary files are removed in success and failure paths. Failed cleanup emits a warning for operator follow-up.

### PDAL runtime (not installed by this task)

The existing integration expects Docker on a Linux development host and a **locally available** PDAL image containing `readers.las` and `writers.copc`. `PDAL_DOCKER_IMAGE` selects it; the default and example pin the PDAL amd64 manifest by digest. No install/pull commands are part of application setup. Runtime uses `--pull=never` and `--network=none`, the host UID/GID and a workspace bind mount. Set the variable to your existing local image as needed. Other architectures need their own compatible pinned image.

PDAL calls use `execFile` without a shell, a one-hour timeout and a 20 MiB output buffer. Named containers are removed after execution, including CLI timeout failures. File paths are restricted to filenames inside the workspace. Empty point clouds and unknown CRS are rejected instead of guessing a projection. The workspace must be accessible to the local Docker daemon; remote Docker daemons are unsupported by this development mode.

A dedicated worker image with Node and native PDAL remains deployment work. This development integration is not a reason to expose the Docker socket to a production application.

## Verification

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm docs:generate
```

Unit tests cover processing success, duplicate delivery, advisory-lock contention, size and point-count failures, retry after metadata failure, final failure, workspace cleanup, COPC header checks, PDAL command options/timeouts/cleanup (mocked), and streaming storage. HTTP tests exercise compiled controller/DTO metadata, validation and Swagger using mocked services. They build first and require no PostgreSQL, Redis, MinIO, Docker or PDAL execution.

These tests **do not prove real conversion or full infrastructure integration**. LAS/LAZ conversion, full upload-to-READY integration, and the 640 MiB case remain to be run against an existing prepared environment.

## Known follow-up work

See [docs/backend-processing-audit.md](docs/backend-processing-audit.md). B1 upload concurrency/completion recovery/expiration, B2 Redis enqueue recovery/requeue, B5 Dataset APIs and B6 infrastructure integration remain separate roadmap work. A completed upload whose enqueue failed is not recovered automatically yet.

## Company smoke-test handoff

Follow [docs/company-smoke-test.md](docs/company-smoke-test.md) for the installed native PDAL runtime, migrations, API/worker startup, frontend CORS and the real-file smoke command. `pnpm test:smoke /absolute/file.laz` streams that file and waits for actual PDAL conversion and READY; it does not install PDAL. `pnpm test:worker-integration` checks the real BullMQ/PostgreSQL/MinIO worker lifecycle with only PDAL mocked and isolated temporary infrastructure.

Real PDAL verification on 2026-11-09 passed for both generated LAS and LAZ through actual BullMQ, MinIO and PostgreSQL to verified COPC/READY. See [the recorded results](docs/real-pdal-test-results.md) for fixture sizes, reproduction and the remaining company/browser acceptance checks. These results supersede earlier statements that all PDAL runtime execution remained unverified.

## Local environment started on 2026-11-09

The ignored backend `.env` was created from `.env.example` with local generated credentials and isolated LiDAR infrastructure. PostgreSQL listens on 15432, Redis on 26379, MinIO on 29000 (console 29001). Start the same infrastructure with:

```bash
docker compose --env-file .env -p lidar-local -f infra/docker/compose.yaml -f infra/docker/compose.local.yaml up -d --pull never
```

These ports correspond to `infra/docker/compose.local.yaml`; the base compose file alone uses different default ports. Do not overwrite `.env` after initializing the volumes: database/storage credentials must stay consistent. API remains on localhost:3000/api/v1, and both frontend origins localhost:5173 and localhost:5174 are allowed. All four migrations were applied and API list/Swagger returned HTTP 200. Restart the Node process after changing `.env`; an already-failed watch process may not watch environment files. Only one API process should use port 3000.

## Server-sent dataset events

`GET /api/v1/datasets/events` is a Nest SSE endpoint. Apply migration `DatasetChangeNotifications1794300000000` before deploying this feature. A PostgreSQL AFTER trigger uses transactional NOTIFY (delivered after commit) for INSERT, meaningful status/error UPDATE, and DELETE. One dedicated LISTEN connection per application process fans these changes out to its SSE subscribers; no per-client database polling is used. BullMQ QueueEvents provides job progress across worker/API processes. Dataset messages exclude metadata and signed URLs. Each client gets a heartbeat every 15 seconds and retry interval of 3 seconds.

Events: `connected`, `dataset-created`, `dataset-updated`, `dataset-deleted`, `dataset-progress`, `sync-required`, `heartbeat`. Clients must refetch REST snapshots on connected/sync-required; the stream has no replay guarantee and does not use Last-Event-ID replay. PostgreSQL listener reconnect broadcasts sync-required. SSE unsubscribe clears heartbeat timers; application shutdown removes listeners and releases the dedicated DB connection. Database pool sizing must account for this listener and processing advisory-lock connections.

For a reverse proxy disable response buffering and compression for this route and allow idle timeouts longer than 15 seconds. X-Accel-Buffering is set to no. Existing API CORS applies to EventSource. This app currently has no authentication; if adding auth, protect the stream as well as REST (EventSource cannot set arbitrary Authorization headers).

Verification: real isolated infrastructure integration asserts stream Content-Type, connection event, committed create/update/delete and BullMQ progress delivery. Frontend tests cover reconnect snapshot requests, direct state/progress events, malformed messages and closing EventSource. Upload byte progress still comes from XHR; server processing progress is a stage milestone.
