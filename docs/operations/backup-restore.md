# Isolated local Compose backup and restore

This runbook is for the dedicated `jobscout-local-dev` stack only. Do not run it with production credentials or a production project. Archives contain user data; keep them out of Git and delete them when no longer needed.

## Create backup

From `AiJob_search_backend`, start the local stack and create a timestamped Mongo archive and Redis RDB copy:

```powershell
npm run stack:up
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path '.local-backups' | Out-Null
docker compose -p jobscout-local-dev -f docker-compose.dev.yml exec -T mongo mongodump --db jobscout_local --archive --gzip > ".local-backups/mongo-$stamp.archive.gz"
docker compose -p jobscout-local-dev -f docker-compose.dev.yml exec -T redis redis-cli BGSAVE
docker compose -p jobscout-local-dev -f docker-compose.dev.yml cp redis:/data/dump.rdb ".local-backups/redis-$stamp.rdb"
Get-ChildItem ".local-backups/*$stamp*" | Select-Object Name,Length
```

Mongo stores application records. Redis stores BullMQ queue state; pause producers if a queue-consistent point-in-time copy is required. The stack uses dedicated named volumes.

## Restore into an empty local stack

The `down -v` command deletes the local Compose volumes. Check project name and compose file first.

```powershell
docker compose -p jobscout-local-dev -f docker-compose.dev.yml down -v
npm run stack:up
docker compose -p jobscout-local-dev -f docker-compose.dev.yml exec -T mongo mongorestore --drop --gzip --archive < '.local-backups/mongo-YYYYMMDD-HHMMSS.archive.gz'
docker compose -p jobscout-local-dev -f docker-compose.dev.yml stop worker
docker compose -p jobscout-local-dev -f docker-compose.dev.yml cp '.local-backups/redis-YYYYMMDD-HHMMSS.rdb' redis:/data/dump.rdb
docker compose -p jobscout-local-dev -f docker-compose.dev.yml restart redis
docker compose -p jobscout-local-dev -f docker-compose.dev.yml start worker
npm run smoke:compose
```

Expected: service health checks pass and smoke prints `PASS`. Compare a known local record count before and after restore. **Rehearsal status: pending**; no local backup worth restoring was present during implementation.
