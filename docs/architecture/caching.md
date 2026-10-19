# Caching audit: catalog-version invalidation

Audit date: 2026-10-18.

## Catalog-dependent cache paths

- Job discovery total counts (`jobs:catalog:count:v{catalogVersion}:{filterHash}`, 120s TTL) and facets (`jobs:catalog:facets:v{catalogVersion}:{filterHash}`, 120s TTL) are cached in Redis and keyed by the monotonic `catalogVersion` so any ingestion run, source policy change, or catalog migration automatically invalidates cached counts and facets without key scanning.
- Recommended match responses are cached for 60 seconds by user profile version and scoring version. They also depend on the active indexed catalog, so they now include the persistent global `catalogVersion` in the cache key.
- Demand-driven ingestion terms are aggregated from non-personal profile role/location counts and were cached under one global key. They now use a catalog-versioned key so source-policy changes cannot reuse a stale plan. Profile aggregation output is not per-user and stores no profile text.
- User board and response caches use user/profile versions; this audit found no shared catalog fields in those paths. Embedding, parsed job-description, resume parsing, company, and session keys are content- or identity-scoped and do not represent catalog counts/facets.

## Version bumps

The version increments after a source completes ingestion, an administrator changes source enablement or approval, and the job catalog or storage split migration applies. Old cache entries naturally expire; no Redis key scan is required. Catalog version state is an additive Mongo document (`JobCatalogVersion`, key `global`). If Mongo is unavailable, catalog endpoints already cannot serve Mongo-backed results and use version 1 only for local fallback behavior.

## Operational note

A future migration or policy change that changes which jobs are eligible for public discovery must call `bumpCatalogVersion()` after its writes succeed. Every count or facet cache key includes `catalogVersion` and is covered by integration tests (`tests/jobs-catalog.mongo.integration.test.js`).
