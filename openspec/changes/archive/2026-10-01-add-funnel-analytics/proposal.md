# Proposal

## Why

Gate M2 (plan.md §12.6) requires "Analytics event cơ bản đi hết funnel", and §12.5 and §12.7 require
end-to-end evidence: the full create → publish → open journey, visual snapshots, text and emoji edge
cases, a cold-cache performance baseline, and "kết quả performance và danh sách issue thực tế".
After the five earlier Sprint 3 changes, a gift can be created, previewed, published and opened, but
nobody can see where creators or recipients drop off. Also, no single document says whether Gate
M2 passed.

The product needs this funnel before templates 2–3 start (plan.md §12.7, "Không bắt đầu Template
2–3 nếu gate này chưa đạt"). It must also respect the privacy baseline of plan.md §3.2 and §20.3
and tech-stack.md §17.2: no PII, no gift text, a pseudonymous gift reference, crawlers kept apart
from people, and no third-party tracker.

## What Changes

- Add a first-party event endpoint, `POST /api/events`:
  - it accepts one strictly validated event per request and answers `204`;
  - it reuses the JSON media-type and same-origin checks of `mutation-request-guards`;
  - it caps the body at 2048 bytes (`413` above that);
  - it has two new rate-limit scopes, `analytics-event` (per network subject and session) and
    `analytics-event-ip` (per network subject);
  - it silently drops, with `204`, requests from declared crawlers and link-preview bots, and every
    request while analytics is disabled.
- Taxonomy (tech-stack.md §17.2, Sprint 3 subset):
  - creator events `customization_started`, `required_content_completed`, `preview_started` and
    `publish_clicked`;
  - the server-only `gift_published`;
  - recipient events `gift_open_interaction`, `scene_completed` and `gift_completed`.

  An event carries only these properties:
  - `templateId` and `templateVersion`;
  - a random `sessionId`, scoped to one gift in one browser tab, so that it never links two
    gifts;
  - `giftRef`, a keyed HMAC of the internal gift id that the server computes;
  - `sceneId`, for `scene_completed` only.

  It never carries a `publicId`, a `shareId`, gift text, an e-mail, a user id, an IP address, a
  user agent or a URL.

- Store events in a new `analyticsEvents` collection. Documents expire after 180 days through a TTL
  index. Migrate the database to schema version `9`, which also adds the two rate-limit scopes to the
  `apiRateLimits` validator.
- Configuration:
  - `ANALYTICS_ENABLED=true` turns analytics on;
  - `ANALYTICS_GIFT_REF_SECRET` (at least 32 characters) keys the HMAC;
  - a missing or short secret disables analytics and never breaks a page;
  - the deployment runbook gets a rotation note.
- Client transport: a same-origin `fetch` with `keepalive`, a JSON body, no credentials and the request referrer policy `strict-origin`. It is
  fire-and-forget: it is never awaited by the UI, never retried, and its failures are ignored. It
  sends nothing when the browser signals Global Privacy Control or Do Not Track. It does not use
  `navigator.sendBeacon`, because a beacon from a `Referrer-Policy: no-referrer` page carries
  `Origin: null`, which the same-origin guard rejects (design D3).
- Hook points:
  - Studio autosave: `customization_started` and `required_content_completed`, each at most once
    per gift and tab;
  - the `Xem trước` action: `preview_started`;
  - the `Xuất bản` action: `publish_clicked`;
  - the publish service: `gift_published`, only for a first, non-replayed publish, written after
    the response;
  - `GiftViewer` lifecycle notifications on the public `/g/{shareId}` page only:
    `gift_open_interaction`, `scene_completed` and `gift_completed`.

  The preview page and the Viewer harness never send events.

- Gate M2 verification (tests and docs, not behavior):
  - extend `apps/web/e2e/publish.spec.ts` to assert the funnel end to end, including the stored
    documents and their privacy;
  - attach visual snapshots of the key scenes with layout assertions;
  - run an edge-case content set (maximum lengths, Vietnamese diacritics, emoji, markup-like text,
    8 photos) through the full journey, checking that preview and published content are equal;
  - add a Playwright cold-cache performance baseline on the production build that records values
    to an attached JSON report and asserts only budget sanity;
  - write `docs/sprints/sprint-3-results.md` with the automated results and the manual Gate M2
    checks still pending.

This change belongs to **Sprint 3, Gate M2** (plan.md §12.5–§12.7). It is the sixth and last
Sprint 3 change, archived in this order: `add-memory-box-template`, `add-schema-driven-studio`,
`add-local-object-storage`, `add-gift-preview`, `add-temporary-gift-publish`,
`add-funnel-analytics` (this change).

## Non-goals

- Dashboards, reports, funnel queries, exports or rollups. Events are stored for ad-hoc analysis
  only.
- A third-party analytics vendor (PostHog, GA, Plausible) or any third-party script. The move to a
  warehouse or vendor (tech-stack.md §17.2) is a later decision (ADR-0010).
- The events `template_demo_started`, `checkout_started`, `payment_succeeded`, `reaction_sent` and
  `gift_replayed`, and reactions in general (Sprint 4–5).
- Technical observability: Sentry, Viewer fallback rates and Web Vitals collection from real users
  (RUM). The `fallback` lifecycle notification is not a funnel event.
- A consent banner, an opt-out setting or privacy-notice copy (plan.md §20.3, Sprint 6). This change
  only honors the browser's Global Privacy Control and Do Not Track signals.
- Enforcing performance thresholds in CI. The baseline is recorded, not gated, except for budget
  sanity checks.
- Carrying out the manual Gate M2 checks. They are listed in the results document for the Product
  Owner.

## Capabilities

### New Capabilities

- `funnel-analytics`: first-party, privacy-safe product funnel events. It covers:
  - the event taxonomy and the stored record;
  - the `POST /api/events` contract, its guards, limits and error codes;
  - exclusion of crawlers and automated traffic;
  - configuration and the `giftRef` pseudonym;
  - retention;
  - the browser transport and the session id;
  - when the Studio, the publish service and the public gift page emit each event, and the rule
    that the preview never emits recipient events.

### Modified Capabilities

- `database-schema-management`:
  - "Collection registry", "JSON-schema validators", "Named indexes", "Idempotent migration with
    ledger" and "Schema verification": they add the `analyticsEvents` collection, its validator and
    indexes (including the TTL index), the scopes `analytics-event` and `analytics-event-ip`, and
    schema version `9`;
  - "Gift persistence verification": its scenario refers to the current schema instead of
    version `8`. The behavior is unchanged.

## Impact

- **Invariants touched**:
  - _Validate untrusted input at every entry_: the event body is parsed with a strict Zod schema
    (enumerated names, formatted ids, no extra keys, size cap) before any write. The server sets
    `occurredAt`. Client clocks and free text are never stored.
  - _Authorize next to data access; opaque 404 for non-owners_: `/api/events` reads no gift and
    authorizes nothing, and it cannot confirm that a gift exists. `giftRef` values reach a page only
    after that page's own authorization: the Studio after the owner filter, `/g` after the
    live-share check. The endpoint checks their format only (design Risks).
  - _Return DTOs, never raw documents_: the endpoint returns no body. No analytics document is ever
    read back by a route.
  - _Never log gift text, tokens or signed URLs_: events hold no text. Share ids and public ids never
    enter an event. Failures log only an operation name and the request id.
  - _Protected gift payloads never enter public caches; nonce CSP routes_: no new page. `/api/events`
    responses are `no-store`. `connect-src 'self'` already allows the request on every page policy.
  - _Recipients never need an account; audio after a gesture_: recipient events start only after
    the `Mở quà` gesture and need no cookie. Requests are sent without credentials.
  - _Long-running or retryable work goes through the outbox_: an event insert is a single
    best-effort write, and `gift_published` is written after the response. Neither is retried, so
    no job is added (design D8).
- **Code**:
  - `packages/contracts`: `analytics.ts` (names, request schema, `giftRef` and scene id schemas);
  - `packages/database`: `COLLECTIONS.analyticsEvents`, its validator and indexes, the rate-limit
    scope enum and version `9`;
  - new `apps/web/src/modules/analytics` (application service and ports, Mongo repository,
    `giftRef` HMAC, route handler, browser client, Studio funnel tracker, recipient event reporter);
  - `apps/web/src/config/analytics.ts` and `apps/web/src/composition/analytics.ts`;
  - `apps/web/src/http/api-response.ts` (bounded body read and `413`);
  - `mongo-gift-rate-limiter.ts` (two scopes);
  - the gifts service (`getStudioGift` returns the analytics context, and `publishGift` gets a
    publish-analytics port);
  - the public gift service (the live-share check returns the analytics context);
  - `preview-action.ts`, `publish-action.ts`, `draft-editor.tsx`, `public-gift-screen.tsx`;
  - `app/api/events/route.ts`, `app/studio/[publicId]/page.tsx`, `app/g/[shareId]/page.tsx`.
- **Tests**:
  - `playwright.config.ts` (analytics env);
  - `apps/web/e2e/publish.spec.ts` (funnel, snapshots, edge cases);
  - a new `apps/web/e2e/gift-performance.spec.ts`;
  - `apps/web/e2e/support/` (the committed `photo.jpg` is already a landscape photo, so no new
    fixture is needed).
- **Docs**:
  - `docs/adr/0010-first-party-funnel-analytics.md`;
  - a "Funnel analytics" section in `docs/architecture.md`;
  - `.env.example`;
  - `docs/runbooks/preview-deploy-and-rollback.md` (variables per environment, secret rotation);
  - `docs/sprints/sprint-3-results.md`.
- **APIs**: new `POST /api/events`. No existing route or DTO changes shape. The Studio page and
  `/g/{shareId}` pass a small analytics context (`giftRef`, `templateId`, `templateVersion`) to
  their client components. That context is not gift content.
- **Data**:
  - the new collection `analyticsEvents` (TTL 180 days);
  - `apiRateLimits` scopes gain `analytics-event` and `analytics-event-ip`;
  - `DATABASE_SCHEMA_VERSION` goes from `8` to `9`.

  The migration is additive, and no existing document changes.

- **Dependencies**: none added.
