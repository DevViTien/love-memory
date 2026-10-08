# funnel-analytics Specification

## Purpose

Defines LoveMemory's first-party product funnel events. It covers:

- which events exist, what they may carry, and how they are stored and expire;
- how browsers submit them through `POST /api/events`, and how that endpoint rejects, limits and
  drops requests;
- how gifts are referenced pseudonymously;
- when the Studio, the publish service and the public gift page emit each event.

The events never carry personal data or gift content.

## Requirements

### Requirement: Event taxonomy and stored record

The system SHALL record only these funnel events:

| Name                         | Emitted by                 | Meaning                                                  |
| ---------------------------- | -------------------------- | -------------------------------------------------------- |
| `customization_started`      | Studio (browser)           | the first edit of a draft was saved                      |
| `required_content_completed` | Studio (browser)           | a save made every template step complete                 |
| `preview_started`            | Studio (browser)           | a preview link was obtained and is being opened          |
| `publish_clicked`            | Studio (browser)           | the creator chose the enabled `Xuất bản` action          |
| `gift_published`             | server only                | a draft was published for the first time                 |
| `gift_open_interaction`      | public gift page (browser) | a recipient chose `Mở quà` and the content was available |
| `scene_completed`            | public gift page (browser) | a recipient moved past a scene                           |
| `gift_completed`             | public gift page (browser) | a recipient reached the end of the gift                  |

Each stored event SHALL consist of exactly these fields:

- `_id`, a random UUID;
- `name`;
- `giftRef`, described in "Gift reference and analytics configuration";
- `templateId` and `templateVersion` of the gift's template version;
- `sessionId`: the browser session UUID for browser events, and `null` for `gift_published`;
- `sceneId`: the scene id for `scene_completed`, and `null` otherwise;
- `occurredAt`, the server time at which the event was accepted;
- `expiresAt`, which is `occurredAt` plus 180 days.

An event MUST NOT contain and the system MUST NOT store with it any of these:

- a gift's `publicId` or `shareId`;
- gift text or a field value;
- an asset id or URL, or a page URL or referrer;
- an e-mail, a user id or an anonymous draft id;
- a cookie, an IP address or a user agent;
- a client-supplied timestamp.

Events SHALL be written only to the application's own database. No third-party analytics service
or script receives them. MongoDB SHALL delete an event once its `expiresAt` has passed.

#### Scenario: Stored browser event

- **WHEN** a valid `scene_completed` event for scene `memory-1` is accepted
- **THEN** exactly one `analyticsEvents` document exists for it, with the fields `_id`, `name`,
  `giftRef`, `templateId`, `templateVersion`, `sessionId`, `sceneId` `memory-1`, `occurredAt` and an
  `expiresAt` 180 days later, and no other field

#### Scenario: No identifying data in any event

- **WHEN** a gift whose `receiver-name` is `Minh Thư` goes through the whole funnel, from its first
  edit to its completion by a recipient
- **THEN** no stored event contains `Minh Thư`, a caption, the gift's `publicId`, its `shareId`, an
  asset id, an e-mail, an IP address or a user agent

#### Scenario: Event retention

- **WHEN** an event was accepted more than 180 days ago
- **THEN** it is removed by the TTL index without any application action

### Requirement: Event collection endpoint

The system SHALL accept browser events at `POST /api/events`, one event per request. It SHALL apply
these checks in this order:

1. the JSON media-type check and the same-origin and Fetch Metadata checks of
   `mutation-request-guards`, answering `415` or `403` with the standard error envelope. A request
   whose `Origin` is `null` fails the origin check;
2. when analytics is disabled, `204` without storing anything or charging any counter;
3. when the request comes from automated traffic ("Automated traffic exclusion"), `204` without
   storing anything or charging any counter;
4. a body larger than 2048 bytes, whether declared by `Content-Length` or found while reading, is
   rejected with `413`, code `VALIDATION_ERROR` and the message `Request body is too large.`;
5. a body that is not valid JSON is rejected with `400`, code `VALIDATION_ERROR` and the message
   `Request body must be valid JSON.`;
6. the body schema below, which rejects with `400`, code `VALIDATION_ERROR` and `fieldErrors`;
7. the rate limits of "Analytics rate limits", answering `429`;
8. the write, answering `204` with no body.

The body SHALL be a JSON object with exactly these keys:

- `name`, one of `customization_started`, `required_content_completed`, `preview_started`,
  `publish_clicked`, `gift_open_interaction`, `scene_completed` or `gift_completed`. The name
  `gift_published` MUST be rejected, because only the server records it;
- `sessionId`, a UUID;
- `giftRef`, 43 base64url characters;
- `templateId`, a lowercase kebab-case identifier of 1–80 characters;
- `templateVersion`, a semantic version of at most 64 characters;
- `sceneId`, a lowercase kebab-case identifier of 1–80 characters. It is required when `name` is
  `scene_completed`, and MUST be absent otherwise.

Any other key SHALL be rejected. Every response of the endpoint, including `204`, SHALL carry
`Cache-Control: no-store` and the `x-request-id` header. A storage failure SHALL answer `500` with
code `INTERNAL_ERROR`, and SHALL be logged only as an operation name and the request id, never with
the request body.

#### Scenario: Valid event accepted

- **WHEN** a same-origin browser posts `{ "name": "gift_open_interaction", "sessionId": <uuid>,
"giftRef": <43 characters>, "templateId": "memory-box", "templateVersion": "1.1.0" }` with
  `Content-Type: application/json`
- **THEN** the response is `204` with no body and `Cache-Control: no-store`, and one event is stored

#### Scenario: Unknown event name

- **WHEN** the body's `name` is `gift_viewed`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors.name` entry, and
  nothing is stored

#### Scenario: Browser claims a publish

- **WHEN** the body's `name` is `gift_published`
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and nothing is stored

#### Scenario: Extra property

- **WHEN** an otherwise valid body also contains `"receiverName": "Minh Thư"` or
  `"shareId": "AbCdEfGhIjKlMnOpQrStUv"`
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and nothing is stored

#### Scenario: Scene id rules

- **WHEN** a `scene_completed` body has no `sceneId`, or a `gift_completed` body has
  `"sceneId": "letter"`, or a `scene_completed` body has `"sceneId": "Memory 1"`
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and nothing is stored

#### Scenario: Oversized body

- **WHEN** a request declares `Content-Length: 4096`, or streams more than 2048 bytes without a
  length
- **THEN** the response is `413` with code `VALIDATION_ERROR` and the message
  `Request body is too large.`, and no counter is charged

#### Scenario: Malformed JSON

- **WHEN** the body is `{`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and the message
  `Request body must be valid JSON.`

#### Scenario: Plain-text beacon rejected

- **WHEN** a request carries `Content-Type: text/plain;charset=UTF-8`, as `navigator.sendBeacon`
  sends a string
- **THEN** the response is `415` with code `VALIDATION_ERROR`, and nothing is stored

#### Scenario: Cross-origin request

- **WHEN** a request carries `Origin: https://attacker.example.test`, or `Origin: null`, or
  `Sec-Fetch-Site: cross-site`
- **THEN** the response is `403` with code `FORBIDDEN`, no counter is charged, and nothing is stored

#### Scenario: Storage failure

- **WHEN** the database throws while an event is being stored
- **THEN** the response is `500` with code `INTERNAL_ERROR`, and the log line holds only the
  operation name and the request id

### Requirement: Analytics rate limits

`POST /api/events` SHALL charge each request that passed the body checks to two counters, in this
order, and it SHALL reject the request when either counter is over its limit. The per-network
`analytics-event-ip` counter SHALL be charged only when the per-session `analytics-event` counter
allowed the request, so one tab that floods events does not use up the budget of the other tabs on
its network:

| Scope                | Subject                            | Limit                         |
| -------------------- | ---------------------------------- | ----------------------------- |
| `analytics-event`    | network subject + body `sessionId` | 60 requests per 600 seconds   |
| `analytics-event-ip` | network subject                    | 1200 requests per 600 seconds |

The network subject SHALL be derived exactly as for the public read rate limit of
`public-gift-viewer`:

- the first value of the trusted `x-vercel-forwarded-for` header, when it is a valid IP address of
  at most 64 characters;
- an IPv6 address is reduced to its `/64` prefix;
- otherwise the shared `unidentified` subject. Its `analytics-event-ip` counter allows five times
  that scope's limit, because it is shared by every unidentifiable client. Its per-session
  `analytics-event` counter keeps the normal limit, because a session belongs to one tab.

The session and the anonymous draft cookie MUST NOT be used as the subject. Counters SHALL use the
same storage, atomic windows and keyed subject hashing as the mutation rate limits, so neither the
address nor the session id is stored in plaintext. A request over a limit SHALL be answered `429`
with code `RATE_LIMITED`, `error.details.retryAfterSeconds` and a matching `Retry-After` header,
and nothing SHALL be stored.

#### Scenario: One tab floods events

- **WHEN** one client behind `x-vercel-forwarded-for: 203.0.113.10` sends 61 valid events with the
  same `sessionId` within one 600-second window
- **THEN** the 61st response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and
  it is not stored

#### Scenario: Rotating session ids from one address

- **WHEN** one address sends 1201 valid events, each with a new `sessionId`, within one 600-second
  window
- **THEN** the 1201st response is `429` with code `RATE_LIMITED`

#### Scenario: Unidentified clients

- **WHEN** requests carry no trusted forwarding header
- **THEN** they share one `analytics-event-ip` counter that allows 6000 requests per 600-second
  window, while each `sessionId` among them is still limited to 60

#### Scenario: A rejected session does not charge the network

- **WHEN** a request is rejected because its `sessionId` already sent 60 events in the window
- **THEN** the `analytics-event-ip` counter of its network subject is not incremented

#### Scenario: Invalid bodies are not charged

- **WHEN** a client sends 100 requests whose bodies fail the schema
- **THEN** each response is `400`, and neither counter for that subject is charged

### Requirement: Automated traffic exclusion

The system SHALL NOT store events from declared crawlers, link-preview fetchers or tools. A request
counts as automated when its `User-Agent` header is missing or empty, or when it contains any of
these substrings, ignoring case:

- `bot`, `crawler`, `spider`, `slurp`;
- `facebookexternalhit`, `facebookcatalog`, `embedly`, `whatsapp`, `skypeuripreview`;
- `lighthouse`, `curl/`, `wget/`, `python-requests`.

Such requests SHALL be answered `204` without storing anything or charging any counter, so the
sender learns nothing. The system MUST NOT store the user agent. The substring match can also catch
a few real browsers whose device name contains one of the substrings, such as a `CUBOT` phone. Their
events are dropped as well, which is an accepted loss.

Recipient events SHALL be emitted only after a person chooses `Mở quà` ("Recipient events on the
public gift page"). A crawler that only fetches `/g/{shareId}` therefore produces no event.

#### Scenario: Link preview crawler

- **WHEN** a request with the `User-Agent` `facebookexternalhit/1.1` posts a valid event
- **THEN** the response is `204`, and nothing is stored

#### Scenario: Missing user agent

- **WHEN** a valid event is posted without a `User-Agent` header
- **THEN** the response is `204`, and nothing is stored

#### Scenario: Share page fetched without a tap

- **WHEN** a crawler or a person loads `/g/{shareId}` and never chooses `Mở quà`
- **THEN** no event is sent or stored for that visit

### Requirement: Gift reference and analytics configuration

The system SHALL identify a gift in events only by `giftRef`: the unpadded base64url encoding of the
HMAC-SHA-256 of the string `lm-gift-ref:v1:` followed by the gift's internal id, keyed with the
server secret `ANALYTICS_GIFT_REF_SECRET`. The same gift SHALL get the same `giftRef` in every event while the
secret is unchanged. The internal gift id, the `publicId` and the `shareId` MUST NOT be derivable
from a `giftRef` without the secret. The server SHALL compute every `giftRef`, and it SHALL give a
`giftRef` to a page only after that page's own access check succeeded:

- the Studio of an authorized draft;
- a live `/g/{shareId}` page.

Analytics SHALL be enabled only when `ANALYTICS_ENABLED` is exactly `true` and
`ANALYTICS_GIFT_REF_SECRET` has at least 32 characters. Any other combination SHALL disable
analytics without failing any page or request. When `ANALYTICS_ENABLED` is `true` and the secret is
missing or too short, the server SHALL also log `analytics_misconfigured` at most once per server
process, without the secret's value. While analytics is disabled:

- pages SHALL receive no analytics context, and browsers SHALL send no event;
- `POST /api/events` SHALL answer `204` after the media-type and origin checks, without storing
  anything;
- the server SHALL NOT record `gift_published`.

A change of the secret yields new `giftRef` values for every gift. Events recorded before and after
the change cannot be joined.

#### Scenario: Stable pseudonym across the funnel

- **WHEN** a creator edits, previews and publishes a gift, and a recipient opens it
- **THEN** every event of that gift, from the Studio, the server and the public page, carries the
  same `giftRef`, and that value differs from the gift's `publicId`, its `shareId` and its internal
  id

#### Scenario: Analytics disabled

- **WHEN** `ANALYTICS_ENABLED` is absent or `false`
- **THEN** the Studio and `/g/{shareId}` render normally and send no event, `POST /api/events`
  answers `204` without storing, and publishing records no `gift_published`

#### Scenario: Misconfigured secret

- **WHEN** `ANALYTICS_ENABLED` is `true` and `ANALYTICS_GIFT_REF_SECRET` has 12 characters
- **THEN** analytics is disabled, every page and the publish endpoint work normally, and the log
  contains `analytics_misconfigured` once, without the secret

### Requirement: Browser event transport

The browser SHALL send each event as one same-origin `POST /api/events` request with these
properties:

- a JSON body and `Content-Type: application/json`;
- the `keepalive` flag, so that the request survives a navigation that follows it;
- no credentials, so no cookie is sent;
- no caching;
- the request referrer policy `strict-origin`, so that only the page's origin, never its path, is
  sent as `Referer`;
- the request mode that carries the page's real `Origin`, including on pages served with
  `Referrer-Policy: no-referrer`.

Sending SHALL be fire-and-forget:

- the UI MUST NOT wait for it;
- a failed request, a rejected request or any status SHALL be ignored, with no retry and no
  message to the person;
- an error while sending MUST NOT interrupt the action that triggered the event.

The browser MUST NOT use `navigator.sendBeacon` for events.

`sessionId` SHALL be a random UUID created once per browser tab and gift, and kept in session
storage under a key that holds only the gift's `giftRef`. It survives reloads and same-tab
navigation for that gift, it is never shared between tabs, and events of two different gifts opened
in the same tab MUST carry different session ids, so a session never links gifts. When session
storage is unavailable, a new UUID SHALL be kept in memory per gift for the page. The session id
MUST NOT be derived from, or linked to, an account, a cookie or a device identifier.

The browser SHALL send no event when the page has no analytics context, when
`navigator.globalPrivacyControl` is `true`, or when `navigator.doNotTrack` is `"1"`.

#### Scenario: Event from a no-referrer page

- **WHEN** the `/g/{shareId}` page, which is served with `Referrer-Policy: no-referrer`, sends
  `gift_open_interaction`
- **THEN** the request carries the page's own origin in `Origin`, not `null`, and it is answered
  `204`

#### Scenario: Studio path not leaked as referrer

- **WHEN** the Studio at `/studio/{publicId}` sends `customization_started`
- **THEN** the request's `Referer` is at most the site origin, and it never contains the
  `publicId`

#### Scenario: Two gifts in one tab

- **WHEN** a person opens one shared gift and then another in the same tab
- **THEN** the events of the two gifts carry different `sessionId` values

#### Scenario: Endpoint unavailable

- **WHEN** `POST /api/events` answers `500` or the network fails while a recipient opens a gift
- **THEN** the gift opens and plays exactly as without analytics, no message is shown, and the event
  is not retried

#### Scenario: Event before a navigation

- **WHEN** the Studio sends `preview_started` and navigates to the preview page immediately
- **THEN** the request is sent with `keepalive` and still reaches the server

#### Scenario: Privacy signal

- **WHEN** the browser reports `navigator.globalPrivacyControl` `true`
- **THEN** no request to `/api/events` is made from any page

#### Scenario: Session storage blocked

- **WHEN** reading session storage throws
- **THEN** events are still sent, with one in-memory session id for the page

### Requirement: Creator funnel events in the Studio

When analytics is enabled, the Studio of a draft SHALL send these events with the draft's
`giftRef`, `templateId` and `templateVersion`:

- `customization_started` when the first save of a creator edit succeeds. It is sent at most once
  per gift and browser tab.
- `required_content_completed` when a successful save leaves every template step complete, in the
  same sense as the Studio's step indicators. It is sent only if at least one template step was
  incomplete earlier in the same Studio page, and at most once per gift and browser tab.
- `preview_started` each time the `Xem trước` action obtains a preview link, before the Studio
  navigates to it. It is not sent when the action is blocked or the request fails.
- `publish_clicked` each time the creator chooses the enabled `Xuất bản` action, before the save
  flush and the publish request. It is not sent while the action is disabled or already busy.

The Studio MUST NOT send any event for a gift that is published: not when it opens a published
gift, not while the owner edits, previews or updates its working copy, and not after the first
publish succeeded in the same page. Loading a draft, moving between steps and a failed save MUST
NOT send an event.

#### Scenario: First autosave

- **WHEN** a creator types into `receiver-name` of a new draft and the autosave answers `200`
- **THEN** `customization_started` is sent once, and later saves in the same tab send it again
  neither after further edits nor after a reload

#### Scenario: Last required field saved

- **WHEN** the save that adds the third photo makes every template step complete
- **THEN** `required_content_completed` is sent once

#### Scenario: Draft already complete when opened

- **WHEN** a creator opens a draft whose template steps are already all complete and edits a
  caption
- **THEN** `customization_started` is sent when that edit is saved, and
  `required_content_completed` is not sent

#### Scenario: Failed save

- **WHEN** the first save of an edit fails with a network error
- **THEN** no event is sent until a save succeeds

#### Scenario: Preview and publish actions

- **WHEN** the creator chooses `Xem trước`, the link is obtained, and later the creator chooses the
  enabled `Xuất bản`
- **THEN** `preview_started` is sent before the navigation, and `publish_clicked` is sent once for
  that click

#### Scenario: Disabled publish action

- **WHEN** an anonymous creator sees `Xuất bản` disabled and clicks it
- **THEN** no `publish_clicked` is sent

#### Scenario: Editing a published gift

- **WHEN** the owner of a published gift edits a caption, opens a preview and chooses
  `Cập nhật món quà`
- **THEN** no analytics event is sent from the Studio

### Requirement: Publish event on the server

When analytics is enabled, the publish service SHALL record exactly one `gift_published` event,
with `sessionId` `null` and the published snapshot's `templateId` and `templateVersion`, for each
publish request that newly publishes a draft. It SHALL NOT record one for these requests:

- a replay of an earlier publish with the same `Idempotency-Key`;
- an update of an already published gift (`gift-publishing`), so each gift has at most one
  `gift_published` event;
- any rejected publish, whatever its status code.

The event SHALL be written after the response is sent, so it adds no latency. A failure to write it
SHALL be logged only as an operation name and the request id. It MUST NOT change the publish
response or its status, and it MUST NOT undo the publication.

#### Scenario: First publish

- **WHEN** an owner publishes a complete draft and gets `201`
- **THEN** exactly one `gift_published` event with that gift's `giftRef` is stored

#### Scenario: Replayed publish

- **WHEN** the same `POST /api/gifts/{publicId}/publish` is replayed with the same `Idempotency-Key`
  and body, and answers `201` again
- **THEN** still only one `gift_published` event exists for that gift

#### Scenario: Update of a published gift

- **WHEN** the owner updates a published gift and gets `201`
- **THEN** still only one `gift_published` event exists for that gift

#### Scenario: Rejected publish

- **WHEN** a publish is rejected with `400`, `403`, `404` or `409`
- **THEN** no `gift_published` event is stored

#### Scenario: Analytics write fails

- **WHEN** storing `gift_published` throws after a successful publish
- **THEN** the creator still got `201`, the gift stays published, and the log holds only the
  operation name and the request id

### Requirement: Recipient events on the public gift page

When analytics is enabled, the `/g/{shareId}` page SHALL turn the gift viewer's lifecycle
notifications into events carrying the published snapshot's `templateId` and `templateVersion` and
the gift's `giftRef`:

- `opened` becomes `gift_open_interaction`, once per page load;
- each `scene` notification marks the scene before it as completed. The page SHALL send
  `scene_completed` with the previous scene's id when the next scene starts;
- `completed` sends `scene_completed` for the last started scene, if not yet sent, and then
  `gift_completed`, once per page load;
- `fallback` sends nothing. After a fallback, no further `scene_completed` or `gift_completed` is
  sent for that page load.

Each scene id SHALL be sent at most once per page load. A scene id that is not a lowercase
kebab-case identifier of at most 80 characters SHALL be skipped. The page SHALL send nothing before
the person chooses `Mở quà`.

The preview page and the Viewer harness MUST NOT send any event. Recipient events
(`gift_open_interaction`, `scene_completed`, `gift_completed`) SHALL come only from `/g/{shareId}`.
The page cannot tell a recipient from a creator who opens their own share link, so such opens are
counted as recipient events too.

#### Scenario: Full play-through

- **WHEN** a recipient opens a gift with three photos and plays it to the end, and the template
  reports the scenes `opening`, `memory-1`, `memory-2`, `memory-3`, `letter` and `finale`, then
  `COMPLETE`
- **THEN** the page sends `gift_open_interaction`, then `scene_completed` for `opening`,
  `memory-1`, `memory-2`, `memory-3`, `letter` and `finale` in that order, then `gift_completed`,
  each exactly
  once

#### Scenario: Template fails after opening

- **WHEN** the template sends `ERROR` during `memory-2` and the static fallback is shown
- **THEN** `gift_open_interaction` and `scene_completed` for `opening` and `memory-1` were sent,
  and no later `scene_completed` or `gift_completed` is sent

#### Scenario: Load fails on tap

- **WHEN** the recipient chooses `Mở quà` and the payload load fails
- **THEN** no `gift_open_interaction` is sent, and choosing `Thử lại` with a successful load sends
  it once

#### Scenario: Preview never reports recipient events

- **WHEN** a creator opens the preview, chooses `Mở quà` and plays the gift to the end
- **THEN** the preview page sends no request to `/api/events`
