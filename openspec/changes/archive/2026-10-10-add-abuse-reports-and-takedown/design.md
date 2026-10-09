# Design

## Context

For the why and the scope, see proposal.md. The relevant code at `ffba734`:

- **Liveness.** `public-gift-service.ts` `resolveLiveShare(shareId)` is the one liveness check of a
  share link. It returns the gift, its current publication and its manifest, or `null`.
- **Public mutation pattern.** `POST /api/events`:
  - `validateJsonMutationRequest`, then the automated user-agent filter (`isAutomatedUserAgent`),
    then the capped body;
  - then the network rate-limit subjects (`publicReadRateLimitSubject`, `publicReadLinkSubject`)
    through `consumeApiRateLimit`.
- **Pause and resume** (`gift-lifecycle`) are conditional writes on `status`. Every recipient read
  requires `status: "published"`.
- **The admin pattern:**
  - `requireAdminPage` and `requireAdminRoute`;
  - transactional state change plus `insertAuditRecord`;
  - list pages that are not audited, and actions and content views that are.
- **Static rendering.** `buildViewerPayload` signs the publication's photos.
  `toStaticGiftBlocks(fields, payload, assets)` turns a payload into plain text and image blocks.
- **Collections.** `abuseReports` is a reserved name in `COLLECTIONS`, not yet managed.

Governing ADRs: ADR-0001, ADR-0005 (route-specific CSP; `/g` and `/admin` are nonce routes),
ADR-0007 (the admin step-up).

## Goals / Non-Goals

**Goals:**

- A recipient reports in two taps, without an account and without revealing the link to anyone.
- An emergency takedown that needs no human in the loop.
- Every moderation action is reversible, atomic and audited.

**Non-Goals:** see proposal.md.

## Decisions

### 1. Module and data

`modules/moderation` holds:

- **application:**
  - `abuse-reports.ts`: the categories, severities, the request schema and the submit service;
  - `moderation.ts`: the queue, the actions and the review;
- **infrastructure:** `mongo-moderation.ts`;
- **presentation:** the report form, the report route handler, the admin route handler and the
  admin views.

**The report document** has these fields:

- `_id` (UUID), `giftId`, `category`;
- `severity`, and `severityRank` (`critical` 0, `high` 1, `normal` 2, used to sort the queue
  index);
- `details` (or `null`);
- `status` (`open`, `actioned` or `dismissed`);
- `createdAt`, `updatedAt` and `resolvedAt`;
- `expiresAt` (`createdAt` plus 365 days).

**Takedown on gifts.** `GiftSchema` gains an optional
`takedown: { at, by: "admin" | "system", reason }`. A takedown is a pipeline update on
`{ _id, status: { $in: ["published", "paused"] }, takedown: { $exists: false } }`:

- `status` becomes `paused`;
- `pausedAt` is kept, or set now;
- `takedown` is set.

**Restore** is a pipeline update on `{ _id, status: "paused", takedown: { $exists: true } }`:

- `status` becomes `published` when `expiresAt > now`, otherwise stays `paused`;
- `pausedAt` is removed when the gift is published again;
- `takedown` is removed.

### 2. Report submission

`POST /api/reports` (`report-route-handler.ts`) runs in order:

1. the media-type and origin guards;
2. `isAutomatedUserAgent`, which answers `202` and stores nothing;
3. the capped body, at most 4096 bytes;
4. the rate limits:
   - `abuse-report` on `publicReadLinkSubject(network, shareId)`: 3 per hour;
   - `abuse-report-ip` on the network subject: 20 per hour;
5. the service:
   - `publicGiftService.findLiveGiftId(shareId)` (new, built on `resolveLiveShare`), which answers
     `404` when the link does not open a gift;
   - `moderation.insertReport({ report, emergency })` in one transaction.

When the severity is `critical`, that transaction also applies the takedown with `by` `system`.
When the takedown write matched, it records `gift.taken_down` (actor
`{ kind: "system", id: "abuse-report" }`).

The handler logs only the operation, the error name and the request id. The body is never logged.

### 3. Owner side

- **Service.** `gift-lifecycle.ts` `resume` answers `GIFT_TAKEN_DOWN` when `gift.takedown` is set.
- **Repository.** The resume filter adds `takedown: { $exists: false }`, so a race with a takedown
  cannot resume.
- **Studio.** `findPaused` returns `takenDown`, and `PausedGiftPanel` renders the takedown notice
  with delete only.

### 4. Admin queue and actions

**The queue.** `/admin/reports` reads `listQueue(limit 100)`:

- the open reports, sorted by `severityRank`, then `createdAt` descending
  (`abuse_reports_queue`);
- one `$in` read of their gifts (`publicId`, `status`, `takedown`), with tombstones for gifts that
  are gone;
- one aggregation counting the open reports per gift (`abuse_reports_gift_status`).

**Actions.** `POST /api/admin/reports/{reportId}` follows the template-version route: the admin
guard with a step-up, then the JSON guards, then a strict body. `moderation.act` runs in one
transaction:

1. read the report;
2. check its state;
3. write the gift (takedown or restore);
4. update the reports (`updateMany` of the gift's open reports, or `updateOne` for a dismiss), with
   `resolvedAt`;
5. insert the audit record.

The audit records:

- `admin.gift.taken_down`: target the gift, metadata `{ reason, reportId }`;
- `admin.report.dismissed`: target `{ kind: "report", id }`, metadata `{ reason: category }`;
- `admin.gift.restored`: target the gift, metadata `{ reportId }`.

**The review page.** `/admin/reports/{reportId}` calls `moderation.review(reportId, session,
requestId)`:

1. it records `admin.gift.content_viewed` first;
2. it loads the gift (`published` or `paused`) and its publication by `publishedRevision`, the
   manifest and the publication's assets;
3. it builds the payload with `buildViewerPayload` (signed URLs, five minutes);
4. it renders `toStaticGiftBlocks` as text and `<img>` tags.

The page is a nonce-CSP admin page, and its `img-src` already allows the asset origin.

### 5. Schema version 15

- **`abuseReports`** becomes managed, with:
  - a validator;
  - the indexes `abuse_reports_queue`, `abuse_reports_gift_status` and the TTL index
    `abuse_reports_expiry_ttl`.
- **`apiRateLimits`** gains the scopes `abuse-report` and `abuse-report-ip`.

There is no backfill.

## Risks / Trade-offs

- **Abuse of the emergency flow.** A recipient could take down a gift they were sent with a false
  critical report. This is acceptable: only holders of the link can report, a takedown is
  reversible, and admins see critical reports first. Rate limits bound repeated reports.
- **Report details may quote gift text or personal data.** They are shown only to admins, never
  logged or audited, and expire after 365 days.
- **An admin viewing private content** is a privacy cost. It is limited to reported gifts and
  audited per view; the lookup stays content-free.
- **Rollback past version 15.**
  - The previous build ignores `takedown`: a taken-down gift stays `paused`, and its owner could
    resume it there. So roll forward quickly.
  - `db:verify` reports drift.

## Migration Plan

1. Deploy, then run `pnpm db:migrate` and `pnpm db:verify`.
2. Smoke test with a test gift:
   - report it as `harassment`, and see it in `/admin/reports`;
   - take it down: the link is not-found and the Studio shows the notice;
   - restore it.
3. Close the risk "Free publishing is open on Production before takedown exists" once checked on
   `stg`.
