## MODIFIED Requirements

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
