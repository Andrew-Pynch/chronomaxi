# chronomaxi Convex backup/restore runbook (big-bertha primary, big-ron nightly snapshot standby)

All commands run from the Next.js repo checkout using .env.local:
  CONVEX_SELF_HOSTED_URL='http://big-bertha:3210'
  CONVEX_SELF_HOSTED_ADMIN_KEY='<from docker compose exec backend ./generate_admin_key.sh>'

## One-time standby bring-up on big-ron
1. Copy the pinned docker-compose.yml to big-ron, same INSTANCE_NAME pattern but a
   DIFFERENT INSTANCE_SECRET/INSTANCE_NAME (e.g. chronomaxi-standby / its own DB name).
2. docker compose up -d
3. docker compose exec backend ./generate_admin_key.sh   # capture standby admin key
4. Point a SEPARATE .env.local (or --deployment flag) at the standby URL+key.
5. npx convex deploy --deployment <standby>              # push schema/functions once
   (backup ZIPs contain ONLY table data, never code/schema/env vars — see
   docs.convex.dev/database/backup-restore FAQ "What does the backup not contain?")

## Nightly cron on big-bertha (primary)
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  npx convex export --path /backups/chronomaxi-$TS.zip
  rsync -avz /backups/chronomaxi-$TS.zip big-ron:/backups/chronomaxi/
  # prune local copies older than 3 days; export-cleanup sidecar handles the
  # in-container /convex/data/storage/exports directory separately.

## Nightly restore on big-ron (cold standby sync, RPO ~24h by design — no multi-master)
  LATEST=$(ls -t /backups/chronomaxi/*.zip | head -1)
  npx convex import --replace-all "$LATEST" -y --deployment <standby>

## Keep environment variables in sync (NOT included in the export ZIP)
  npx convex env list > env.snapshot                       # from primary
  npx convex env set --from-file env.snapshot --deployment <standby>

## Ad-hoc manual backup before any risky operation (schema change, bulk migration, upgrade)
  npx convex export --path /backups/manual-pre-change-$(date -u +%Y%m%dT%H%M%SZ).zip

## Emergency restore of primary from a known-good backup
  1. Take one more backup first — restore is destructive (wipes existing data).
  2. npx convex import --replace-all <good-backup>.zip -y
  3. npx convex deploy               # push known-good code if the emergency involved a bad deploy
  4. npx convex env set --from-file <saved-env-snapshot>
  5. Resume tracker traffic only after 1-4 are confirmed.

## In-place version upgrades (preferred over export/import when no downtime needed)
  1. npx convex export --path /backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).zip   # safety net
  2. Bump the pinned image tag in docker-compose.yml (both backend AND dashboard, same
     precompiled-YYYY-MM-DD-<sha> release), docker compose up -d
  3. Watch logs for "Executing Migration N/M ... MigrationComplete(M)" to confirm the
     in-place migration finished before resuming traffic.
