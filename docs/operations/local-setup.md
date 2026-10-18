# Local development and tests

## Isolated test configuration

Tests and smoke checks use loopback MongoDB/Redis only. The backend currently consumes `MONGODB_URI` and `REDIS_URL`; test bootstrap now rejects non-loopback values and supplies local defaults before application configuration is imported. Never copy a hosted `.env` into test commands.

With a matching MongoDB 8 system server installed, run:

```powershell
$env:MONGOMS_SYSTEM_BINARY = 'C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe'
$env:MONGOMS_VERSION = '8.0.8'
$env:REDIS_URL = 'redis://127.0.0.1:6379'
npm test
```

The CI job uses MongoDB 8 and Redis with `--maxmemory-policy noeviction` service containers. The compose setup below uses isolated service names inside its private network.

## Compose stack

Docker Compose is optional and is not verified until the owner runs it. From the backend repository:

```powershell
npm run stack:up
npm run smoke:compose
npm run stack:down
```

Expected: Mongo, Redis, API, worker, and frontend report healthy; smoke ends with `PASS`. The stack uses a dedicated compose project and local volumes; it does not load production secrets or enable external feeds. For direct development, `npm run dev:stack` remains available.

