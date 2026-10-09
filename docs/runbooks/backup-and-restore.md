# Backup and restore runbook

Owner: Tech Lead. Targets until the PO sets others:

- **RPO** (data that may be lost): **24 hours**;
- **RTO** (time to restore service from a total database loss): **4 hours**.

## What is backed up

| Data                                                                                  | Where it lives            | Backup                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gifts, revisions, publications, users, sessions, reports, audit log, jobs, tombstones | MongoDB Atlas, per tier   | Atlas cloud backup. **Requires a dedicated cluster tier** (M10 or higher): shared tiers have no snapshots. Daily snapshots kept 7 days at minimum; continuous backup (point in time) on Production. |
| Photos (processed WebP derivatives)                                                   | Private Vercel Blob store | No application backup. Durability is the provider's. A deleted or lost object is a lost photo; the gift falls back to its caption or `Ảnh {n}`.                                                     |
| Template artifacts, audio library                                                     | The repository            | Git.                                                                                                                                                                                                |
| Secrets                                                                               | Vercel and Trigger.dev    | Not backed up: rotate instead ([credential rotation runbook](./credential-rotation.md)).                                                                                                            |

**Deletion and backups.** A gift deleted by its owner is purged from the live database within 24
hours. It remains in Atlas snapshots until they expire (7 days by default). The privacy notice
must not promise faster erasure than the snapshot retention.

## Restore drill (to staging, never over Production)

Run it before the Production launch, then every quarter. Record each run here.

1. In Atlas, restore the latest Production snapshot into a **new** cluster or database named
   `love_memory_restore_<date>`. Never restore over a live database.
2. Point a local shell at it: `MONGODB_URI` of the restore cluster, and
   `MONGODB_DATABASE=love_memory_restore_<date>`.
3. Run `pnpm db:verify` and `pnpm db:verify-gifts`. If the snapshot is older than the deployed
   schema version, run `pnpm db:migrate` first.
4. Spot-check: open counts of `gifts`, `giftPublications` and `users` against Production, then
   read one published gift through a local `pnpm dev` pointed at the restore. Blob objects are
   shared, so photos load.
5. Measure the time from step 1 to a verified database: it must be within the RTO.
6. Drop the restore database and record the date, the snapshot age (RPO) and the duration (RTO).

## Restoring Production for real

1. Stop writes: put the tier in maintenance (pause Vercel promotion, and disable the Trigger.dev
   schedules).
2. Restore the chosen snapshot into a new cluster, as in the drill.
3. Verify it with `db:verify` and `db:verify-gifts`.
4. Switch `MONGODB_URI` of the tier to the restored cluster, redeploy, and run `pnpm jobs:deploy`.
5. Check readiness, sign-in, one published gift, and `pnpm jobs:dead`.
6. Tell users if data was lost (the window between the snapshot and the incident), and record the
   incident.

## Drill records

| Date | Snapshot age | Duration | Result |
| ---- | ------------ | -------- | ------ |
