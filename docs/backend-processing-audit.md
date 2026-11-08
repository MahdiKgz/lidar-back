# Backend processing audit — 2026-11-08

Scope: the roadmap's first suggested task (audit B3/B4, implement the smallest processing path), plus requested Swagger documentation for implemented APIs. No frontend work. No real PDAL execution. The image download that started before the user's no-install instruction finished before cancellation; the newly downloaded image was subsequently removed.

## Initial findings

- Git working tree was clean. Nest dependencies were absent, so the first build failed on module resolution. `pnpm install --frozen-lockfile` restored dependencies without changing versions. Node needed `NODE_USE_ENV_PROXY=1` for npm access in this environment.
- `PdalService` existed with Docker `execFile`, inspect and COPC pipeline methods. It used an unpinned `latest` image, logged raw execution errors and did not verify output as COPC.
- `ProccessingService` already enqueued deterministic dataset jobs with attempts/backoff/retention. `ProccessingModule` did not export the service consumed by UploadsModule. No `ProcessingProcessor` existed.
- Storage supported bucket initialization, multipart initiation, part signing, paginated part listing, complete/abort, object size, signed download and deletion. No streaming disk download/upload methods existed.
- Dataset fields matched the roadmap: UUID, filename, format, bigint string size, original object key, status, jsonb metadata, processing error and timestamps. Statuses: UPLOADING, UPLOADED, QUEUED, PROCESSING, READY, FAILED. UploadSession and migrations existed, including correction of earlier column spelling errors. Synchronization was disabled.
- Dataset HTTP routes were Nest-generated placeholders. Global DTO validation and Swagger setup were missing. CORS configuration used a mismatched origin config key and `allowHeaders` instead of `allowedHeaders`.
- Docker was available, but no local PDAL image or repository LAS/LAZ fixture was present. Actual PDAL conversion was not established.

## Changed files and decisions

| Files | Change |
| --- | --- |
| `src/proccessing/processing.processor.ts`, `processing.types.ts` | Worker flow, typed job/metadata, per-dataset advisory lock, retry state transitions and cleanup |
| `src/proccessing/proccessing.module.ts`, `proccessing.service.ts` | Register worker, storage/entity imports, export queue service, typed payload |
| `src/proccessing/pdal.service.ts` | Pin default image, prohibit pulls/network, UID/GID mount permissions, bounded execution, container cleanup, validate metadata/CRS and COPC VLR |
| `src/storage/storage.service.ts` | Stream object to disk and disk file to S3 without buffering point clouds |
| `src/main.ts` | Activate validation, Swagger, correct CORS keys |
| `src/swagger.ts`, `src/uploads/uploads.controller.ts`, `src/uploads/dto/*.ts` | Document five upload endpoints, request/response shapes, limits and workflow |
| `src/datasets/datasets.controller.ts` | Exclude placeholder routes from Swagger |
| `scripts/export-openapi.mjs`, `docs/openapi.json`, `package.json`, `pnpm-lock.yaml` | Official Nest Swagger dependency and offline OpenAPI generation; compiled HTTP tests |
| `src/proccessing/*.spec.ts`, `src/storage/storage.service.spec.ts`, `test/app.e2e-spec.ts` | Behavioral tests using mocked external services |
| `.env.example`, `README.md`, this report | Runtime configuration, setup, scope, verification and remaining work |

No schema changes were made; no migration or infrastructure mutation was needed. Existing module spelling `proccessing` was retained to avoid unrelated renames. READY is saved only after output validation, upload and size verification. Output retries use a deterministic key and preserve the original object. Unknown CRS fails explicitly. Docker execution remains a development integration, with dedicated production worker packaging deferred.

## Verification results

- `pnpm build`: passed.
- `pnpm lint`: passed; two pre-existing unused-parameter warnings remain in Dataset scaffold service.
- `pnpm test`: 20 tests passed across 5 files.
- `pnpm test:e2e`: 10 HTTP/Swagger tests passed (mocked services, production compiled metadata).
- `pnpm docs:generate`: generated the five upload paths and response schemas without external services.
- No LAS/LAZ/COPC runtime test, browser CORS test, production telemetry query or 640 MiB integration test was performed.

## Remaining risks / next phases

1. B1: concurrent or repeated complete/abort, failure between storage completion and DB commit, size verification per part, expiration cleanup and real browser CORS need stabilization.
2. B2: a DB-completed upload can be stranded if Redis enqueue fails. Automatic reconciliation/requeue and final failed-job recovery remain unimplemented.
3. B3/B4 acceptance remains pending real LAS/LAZ conversion with installed PDAL, readable COPC in MinIO, real Redis/PostgreSQL integration, and permission/timeout checks in that environment. Cleanup failures warn but need operational handling.
4. Advisory locks consume one DB connection per active dataset; crashed workers release their session locks when the DB connection closes. Multi-instance deployments and stalled-job behavior need integration testing. Per-process worker concurrency is 1.
5. B5: implement real Dataset list/detail/status/download/COPC/delete APIs. Current scaffold routes are excluded from documentation.
6. B6: real infrastructure tests and the large-file acceptance case remain. Production images/worker packaging and image pinning for the existing compose infrastructure are not completed.

The roadmap requests one task at a time and review before the next phase (section 4, item 11). This processing step is ready for code review; full acceptance is pending the real-environment checks above.

## Continuation: all-backend authorization

The user subsequently authorized continuing through all backend phases without phase approval stops. B1 upload locking/recovery, part byte validation, resume validity, expiry cleanup; B2 durable DB enqueue reconciliation/requeue; B5 complete Dataset APIs and safe deletion; uniform error responses; native PDAL runtime support; standalone worker entry; pinned compose images; and infrastructure integration tooling have now been implemented. See the current status at the top of README.md, which supersedes the initial remaining-work list above.

Verified continuation: migrations ran on an isolated PostgreSQL instance; real MinIO multipart upload of 671,811,028 synthetic bytes in 41 parts matched the final object length; repeated complete, Redis job creation, pagination, status, requeue, Range download (206), deletion and repeated deletion passed. Temporary containers were removed afterwards. Unit and HTTP suites also passed. Real PDAL acceptance remains unverified because PDAL is intentionally not installed. Browser CORS, Redis restart and multiple-process stress tests remain acceptance checks rather than claimed results.
