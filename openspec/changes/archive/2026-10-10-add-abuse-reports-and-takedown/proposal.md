# Add abuse reports and takedown

## Why

Anyone can publish a Free gift on every tier. Nothing lets a recipient report a harmful gift, and
nothing lets the operations team take one down. The risk register's "Free publishing is open on
Production before takedown exists" must be decided before promoting to `main`. Plan.md §15.2 and
Gate M5 ("Admin xử lý report từ đầu đến cuối") require reports, a review queue, takedown, an audit
trail and an emergency flow. This is Sprint 6 change 5
([sprint-6-plan.md](../../../docs/sprints/sprint-6-plan.md)).

## What Changes

- **Report form.** The recipient page `/g/{shareId}` gains `Báo cáo nội dung`. It opens a form with
  a category, optional details (at most 1000 characters) and `Gửi báo cáo`.
  - **Severity** follows from the category: `critical`, `high` or `normal`.
  - **The endpoint** is `POST /api/reports`. It needs no account and is rate limited per network
    and link (`abuse-report`) and per network (`abuse-report-ip`).
  - **What is stored.** The report keeps the gift's internal id, never the share id or the
    reporter's address.
- **Emergency flow.** A `critical` report (`child_safety`, `self_harm`) takes the gift down at once
  (by the system), in the same transaction as the report. An admin then confirms or restores it.
- **Takedown.** A taken-down gift is `paused`, with a `takedown` record of when, by whom and why.
  - Its share link is not-found.
  - The owner cannot resume it (`409 GIFT_TAKEN_DOWN`), but can still delete it.
  - The Studio's paused panel shows a takedown notice instead of resume.
- **Admin review queue.** `/admin/reports` lists open reports: critical first, then high, then
  normal, newest first within each. Each shows its category, details, time, the gift's
  `publicId` and status, and the number of open reports on that gift.
  - **Actions.** `Gỡ món quà` takes the gift down and closes its open reports as `actioned`.
    `Bỏ qua` dismisses one report. `Khôi phục` lifts a takedown and closes the gift's open reports
    as `dismissed`.
  - **Review page.** `/admin/reports/{reportId}` shows the reported publication's text and photos
    in the static rendering, and is audited as `admin.gift.content_viewed`. It is the only place an
    admin sees gift content.
- **Audit:**
  - `admin.gift.taken_down`, `admin.gift.restored`, `admin.report.dismissed` and
    `admin.gift.content_viewed`;
  - `gift.taken_down` by the system, for the emergency flow.

  No report details or content go into the audit log.

- **Schema version 15.** `abuseReports` becomes a managed collection, with a validator, a queue
  index, a gift index and a 365-day expiry. The rate-limit scopes `abuse-report` and
  `abuse-report-ip` are added.

## Capabilities

### New Capabilities

- `abuse-reports`: the report form and endpoint, the emergency flow, the admin queue and actions,
  the content review page, and takedown.

### Modified Capabilities

- `gift-lifecycle`:
  - "Pause and resume a published gift": resume is refused while taken down;
  - "Owner controls in the Studio": the takedown notice.
- `audit-log`: "Audit records": the new actions.
- `mutation-request-guards`: "Distributed mutation rate limits": the two report scopes.
- `database-schema-management`: "Collection registry", "JSON-schema validators", "Named indexes",
  "Idempotent migration with ledger" and "Schema verification", for version 15.

## Non-goals

- **Email to the owner on takedown, and email to the reporter.** These need `email.send` (Sprint 5
  `add-system-emails`). Until then the owner sees the Studio notice.
- **A captcha.** Rate limits, the automated user-agent filter and the requirement of a live share
  link bound abuse at MVP scale.
- **Account bans or suspension.** Reporting a creator, rather than a gift, is out of scope.
- **Appeals.** The owner can contact support; an admin restores.
- **Exporting reports.** Legal escalation outside the product.

## Impact

- **Code.**
  - New `modules/moderation` (application, infrastructure, presentation);
  - `modules/gifts` (takedown blocks resume; the Studio notice);
  - `modules/public-gifts` (the report link on `/g`);
  - the admin area (queue, review page, routes);
  - `packages/domain` (a `takedown` field on gifts);
  - `packages/database` (schema version 15).
- **Invariants:**
  - **Opaque 404 and authorization.** The report endpoint needs a live share link, and answers
    `404` like `/g` otherwise. Admin routes use the admin guard.
  - **No sensitive logging.** Report details and share ids are never logged or audited. Reports
    store neither IP addresses nor share ids.
  - **Content seen by admins only on the audited review page.** The lookup still never shows
    content.
  - **Public caches.** `/g` stays `private, no-store`; the report endpoint is a no-store API.
  - **Retryable work in jobs.** A takedown is a single conditional write with its audit record;
    nothing slow runs in the request.
