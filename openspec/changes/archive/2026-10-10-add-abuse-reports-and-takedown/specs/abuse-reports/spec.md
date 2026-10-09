# Spec Delta

## Purpose

Lets a recipient report a harmful gift without an account, and lets the operations team review
reports, take a gift down, or restore it, with an emergency takedown for the most severe
categories. Reports never expose the share link or the reporter, and every moderation action is
audited.

## ADDED Requirements

### Requirement: Report form on the recipient page

`/g/{shareId}` SHALL show, below the gift and outside the template's frame, a `Báo cáo nội dung`
button. It SHALL open a form with:

- **A required category**, chosen from:
  - `child_safety` `Xâm hại trẻ em`;
  - `self_harm` `Tự gây hại hoặc đe doạ tính mạng`;
  - `violence` `Bạo lực hoặc đe doạ`;
  - `sexual` `Nội dung tình dục không mong muốn`;
  - `illegal` `Hoạt động phạm pháp`;
  - `harassment` `Quấy rối hoặc lăng mạ`;
  - `spam` `Lừa đảo hoặc spam`;
  - `other` `Lý do khác`.
- **Optional details** labelled `Mô tả thêm (không bắt buộc)`, of at most 1000 characters.
- **The submit button** `Gửi báo cáo`.

After a successful report the form SHALL be replaced by
`Cảm ơn bạn. Chúng tôi sẽ xem xét báo cáo này.` A failed request SHALL show
`Chưa gửi được báo cáo — thử lại.`, keeping the form. Opening the form SHALL NOT pause the gift or
its audio.

#### Scenario: Recipient reports a gift

- **WHEN** a recipient chooses `Báo cáo nội dung`, picks `Quấy rối hoặc lăng mạ` and sends the form
- **THEN** the page shows `Cảm ơn bạn. Chúng tôi sẽ xem xét báo cáo này.`

#### Scenario: Report request fails

- **WHEN** the report request answers `429`
- **THEN** the page shows `Chưa gửi được báo cáo — thử lại.` and keeps the chosen category

### Requirement: Report endpoint

`POST /api/reports` SHALL take a strict JSON body of at most 4096 bytes:
`{ "shareId": <string>, "category": <category>, "details"?: <string of at most 1000 characters> }`.

**Order of checks:**

1. It passes the media-type and origin guards of `mutation-request-guards`.
2. A request whose user agent is automated (as for analytics events) SHALL answer `202` and store
   nothing.
3. The rate limits apply after the body is parsed: `abuse-report` per network and share id, then
   `abuse-report-ip` per network.
4. A share id that does not open a live gift (`public-gift-viewer`) SHALL answer `404` `NOT_FOUND`,
   exactly as an unknown one.

**A stored report** holds:

- the gift's internal id;
- the category;
- its severity: `critical` for `child_safety` and `self_harm`; `high` for `violence`, `sexual` and
  `illegal`; `normal` otherwise;
- the details (or `null`);
- `status` `open`, and the creation time;
- `expiresAt`, 365 days later.

It MUST NOT hold the share id, an IP address, a user agent or any reporter identity. The answer is
`202` with `data.received` `true`. Report details and share ids MUST NOT be logged.

#### Scenario: Report stored without the share id

- **WHEN** a report with details `Ảnh xúc phạm` is sent for a live gift
- **THEN** the response is `202`, and the stored report holds the gift's internal id, the category,
  its severity and the details, and no share id

#### Scenario: Report for a link that does not open

- **WHEN** a report names a share id of a paused, expired or unknown gift
- **THEN** the response is `404` with code `NOT_FOUND`, and nothing is stored

#### Scenario: Report spam limited

- **WHEN** the same network sends a fourth report for the same share id within one hour
- **THEN** the response is `429` with code `RATE_LIMITED`, and nothing is stored

### Requirement: Takedown

A takedown SHALL pause a gift on behalf of the operations team. The gift becomes `paused` (if it
was `published`), and holds a `takedown` record with:

- `at`;
- `by`: `admin` or `system`;
- `reason` (a report category).

While it holds a takedown:

- its share link SHALL be not-found;
- the owner SHALL NOT resume it (`gift-lifecycle`);
- the owner MAY still delete it.

Lifting a takedown (a restore) SHALL remove the record. The gift SHALL become `published` again
when its `expiresAt` has not passed, and otherwise stay `paused`. A gift being deleted SHALL NOT be
taken down or restored.

#### Scenario: Owner cannot resume a taken-down gift

- **WHEN** the owner of a taken-down gift sends `POST /api/gifts/{publicId}/resume`
- **THEN** the response is `409` with `details.reason` `GIFT_TAKEN_DOWN`, and the gift stays paused

### Requirement: Emergency takedown

A stored report of severity `critical` SHALL take its gift down by the system in the same
transaction as the report, when the gift has no takedown yet. It records `gift.taken_down` with:

- the actor `{ kind: "system", id: "abuse-report" }`;
- the gift as target;
- `{ reason }` as metadata.

The report stays `open` for review.

#### Scenario: Critical report pauses the gift at once

- **WHEN** a recipient reports a live gift as `child_safety`
- **THEN** the share link answers not-found from the next request, the gift holds a takedown by
  `system`, and the report is first in the admin queue

### Requirement: Admin review queue

`/admin/reports` SHALL be an admin page (`admin-access` "Admin area guard") that lists the open
reports: critical first, then high, then normal, and the newest first within a severity. Each row
shows:

- the category and severity, and the time;
- the details;
- the gift's `publicId` and status, and whether it is taken down;
- the number of open reports on that gift;
- a link `Xem nội dung` to the review page.

A stepped-up admin SHALL act with `POST /api/admin/reports/{reportId}` and a strict body
`{ "action": "takedown" | "dismiss" | "restore" }`:

- **`takedown`** (`Gỡ món quà`) takes the gift down (`by` `admin`, `reason` the report's
  category), unless it already holds a takedown. It closes every open report of the gift as
  `actioned`, and records `admin.gift.taken_down` with `{ reason }`.
- **`dismiss`** (`Bỏ qua`) closes this report as `dismissed`, and records `admin.report.dismissed`.
- **`restore`** (`Khôi phục`) lifts the gift's takedown, closes every open report of the gift as
  `dismissed`, and records `admin.gift.restored`.

Each action, its report updates and its audit record SHALL be one transaction. The answer is `200`
with the report's new status and the gift's status.

- An unknown report answers `404`.
- A closed report answers `409` `REPORT_CLOSED`, except `restore`.
- A restore of a gift without a takedown answers `409` `NOT_TAKEN_DOWN`.
- A gift that no longer exists answers `409` `GIFT_GONE`, and the report can only be dismissed.

#### Scenario: Admin takes a reported gift down

- **WHEN** a stepped-up admin chooses `Gỡ món quà` on an open report
- **THEN** the gift is paused with a takedown by `admin`, its open reports are `actioned`, the share
  link is not-found, and the audit holds `admin.gift.taken_down`

#### Scenario: Admin restores after an emergency takedown

- **WHEN** an admin chooses `Khôi phục` for a gift taken down by the system, whose `expiresAt` has
  not passed
- **THEN** the gift is `published` again, its open reports are `dismissed`, and the audit holds
  `admin.gift.restored`

#### Scenario: Creator sees no queue

- **WHEN** a signed-in creator opens `/admin/reports`
- **THEN** the not-found page is rendered with HTTP `404`

### Requirement: Reported content review

`/admin/reports/{reportId}` SHALL be an admin page that shows:

- the report;
- the gift's current publication in the static rendering (text fields, dates, and photos through
  short-lived signed URLs), even while the gift is taken down;
- the three actions.

Before the content is rendered, it SHALL record `admin.gift.content_viewed`, with the gift as
target and `{ reportId }` as metadata. A failed audit write fails the page. A report whose gift
no longer exists or has no publication SHALL show `Không còn nội dung để xem.`

#### Scenario: Admin reviews reported content

- **WHEN** a stepped-up admin opens the review page of a report
- **THEN** the page shows the publication's text and photos, and the audit holds
  `admin.gift.content_viewed` for that gift before anything else is recorded

### Requirement: Report retention

A report SHALL be kept 365 days after its creation and then removed by the expiry index. A report is
not deleted when its gift is deleted, and it holds no gift content.

#### Scenario: Report outlives the deleted gift

- **WHEN** the owner deletes a gift that has a report
- **THEN** the report remains, with the gift's internal id, until its `expiresAt`
