# Local setup

The supported local stack uses the backend API on `4001`, frontend on `3000`, MongoDB, and Redis. From the backend root, copy `.env.example` to `.env`, install dependencies with `npm ci`, and install the sibling frontend dependencies with `npm ci` in `../Ai_resume_frontend`. Start the API, background worker, and frontend together with `npm run dev:stack`; MongoDB and Redis must already be available. Ctrl+C stops the three child processes.

For separate terminals, run `npm run dev`, `npm run worker:dev`, and `npm run dev` in the frontend directory. The worker owns repeatable job ingestion and asynchronous match refresh, so it needs Redis. It registers approved source repeat jobs idempotently at startup and refreshes a Redis heartbeat every 15 seconds (45-second TTL). Use `npm run jobs:schedule:report` to inspect registrations, worker status, and last seen time.

BullMQ requires Redis `maxmemory-policy noeviction`. Verify it with `redis-cli CONFIG GET maxmemory-policy`. The application logs an error in production when the policy differs; it does not change Redis configuration.

`npm run test` uses `mongodb-memory-server` for tests and does not need a developer MongoDB server. It may need network access the first time MongoDB's test binary is downloaded. No external AI or job provider is needed for unit and fixture tests.

To inspect existing resume role-extraction coverage without printing resume text or writing data, run `npm run resumes:roles:report`. This decrypts each stored resume in memory, runs the deterministic section parser, and prints only per-record counts/status. It never persists extracted roles.

**OneDrive note:** a Next.js build in a OneDrive-synced checkout has previously failed with `EPERM` while writing `.next`. Stop the frontend dev server before building. If it recurs, build from a temporary checkout outside OneDrive, with environment files excluded. Do not remove `.next` while a server or build is using it.

As built, the project uses local MongoDB and Redis URLs by default. A local S3-compatible emulator is not bundled; using one requires a separate decision. In development, configured mocks are controlled by `AI_ALLOW_MOCKS`.
