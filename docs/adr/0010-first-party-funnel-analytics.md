# ADR-0010: Record the product funnel first-party, in MongoDB

- Status: accepted
- Date: 2026-10-01

## Context

Gate M2 (plan.md §12.6) needs basic analytics events through the whole funnel, and later sprints
need to see where creators and recipients drop off. tech-stack.md §17.2 names "PostHog or
equivalent" for product analytics. That is a stack note, not a decision. The privacy baseline is
strict (plan.md §3.2, §20.3):

- no personal data and no gift content in analytics;
- a pseudonymous gift reference instead of a public id or share link;
- crawlers and link-preview bots kept apart from people;
- no third-party script on gift pages. The public gift page runs a nonce CSP without third-party
  origins ([ADR-0005](./0005-route-specific-csp.md)).

The privacy notice and consent copy arrive in Sprint 6, so whatever is collected before then must
be defensible without them.

## Decision

- **First-party events in the operational database.** Browsers post one strictly validated event
  per request to `POST /api/events`. The server stores it in the `analyticsEvents` collection with
  exactly nine fields: `_id`, `name`, `giftRef`, `templateId`, `templateVersion`, `sessionId`,
  `sceneId`, `occurredAt` (server time) and `expiresAt`. A TTL index deletes every event 180 days
  after it was accepted. The Sprint 3 taxonomy has eight names, from `customization_started` to
  `gift_completed` (`openspec/specs/funnel-analytics`).
- **`giftRef`, a keyed pseudonym.** It is the unpadded base64url HMAC-SHA-256 of
  `lm-gift-ref:v1:{internal gift id}`, keyed with a dedicated `ANALYTICS_GIFT_REF_SECRET`. The
  server computes it and hands it only to pages that passed their own access check: the owner's
  Studio and a live `/g/{shareId}`. No public id, share id, text, e-mail, user id, IP address or
  user agent enters an event.
- **No vendor and no third-party script.** Events never leave the application's database.
- **Transport.** The browser sends a same-origin `fetch` with `keepalive`, no credentials and the
  request referrer policy `strict-origin`. It is fire-and-forget, and it sends nothing under Global
  Privacy Control or Do Not Track. The session id is random, kept per gift and tab in session
  storage, so a session never links two gifts.
- **`gift_published` on the server.** The publish service records it after the response with
  Next's `after()`, only for a first, non-replayed publish.
- **Off by default.** Analytics runs only when `ANALYTICS_ENABLED=true` and the secret has at least
  32 characters. `dev` and `stg` turn it on. Production stays off until the Sprint 6 privacy copy
  ships. This is an accepted product decision, and turning analytics on later is an environment
  change, not a code change.

## Alternatives rejected

- **PostHog or another vendor now.** A vendor script or proxy adds a third-party origin to gift
  pages or a server-side forwarding path. It also adds a processor to the privacy notice that does
  not exist yet, and the cost and setup do not fit a funnel of eight events. A vendor stays an
  option behind the same event names.
- **`navigator.sendBeacon`.** A beacon is a `no-cors` request. On `/g` and `/preview`, which send
  `Referrer-Policy: no-referrer`, it carries `Origin: null`, which the same-origin guard rejects.
  As a string or `text/plain` blob it also fails the JSON media-type check, and Chromium refuses an
  `application/json` beacon. Accepting `text/plain` would reopen the cross-site "simple request"
  path that the media-type guard closes. `fetch` with `keepalive` keeps the one property a beacon
  was wanted for: the request survives the navigation that follows it.
- **An outbox job for `gift_published`.** The outbox exists for business work that must happen and
  be retried. An analytics row is best-effort by definition. An outbox row per publish would add a
  job type, a worker path and retries for data the spec allows to lose.
- **Writing `gift_published` inside the publish transaction.** That adds latency and a failure mode
  to publishing, and it couples the analytics collection's availability to it.

## Consequences

- The funnel joins across Studio, server and recipient through `giftRef`. Rotating the secret
  breaks joins across the rotation
  ([deployment runbook](../runbooks/preview-deploy-and-rollback.md#rotating-the-analytics-gift-ref-secret)).
- Every analysis is ad hoc, against the `analytics_events_name_occurred` index. No dashboard or
  rollup exists.
- **Known biases:**
  - an owner who opens their own `/g` link counts as a recipient, because the page cannot tell them
    apart without identifying the viewer. Read open and completion counts as upper bounds;
  - the bot substring match (`bot`, `crawler`, …) also drops a few real browsers whose user agent
    contains a listed substring, such as `CUBOT` phones;
  - recipients who see the static fallback never send `gift_completed`, so completion is
    understated when a template breaks. Fallback rates belong to technical observability (Sentry,
    Sprint 7).
- Anyone can post well-formed events with made-up `giftRef` values. The damage is limited to
  analytics counts, rate limits bound the volume, and `gift_published` cannot be forged.
- Events share the operational cluster. At 1 000 published gifts a day with about 20 events each,
  180 days hold about 3.6 M documents, around 1–1.5 GB with indexes.

## Exit criteria

Export to a warehouse, or move to a vendor behind the same event names, when one of these holds:

- the collection grows past the volume estimate above;
- analytics queries measurably load the operational cluster;
- the product needs cohort or retention analysis that ad-hoc queries cannot serve.

Turning analytics on in Production needs the Sprint 6 privacy notice and consent copy, not this
ADR to change.
