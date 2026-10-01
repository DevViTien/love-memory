# Spec Delta

## MODIFIED Requirements

### Requirement: Versioned message protocol

The system SHALL exchange host↔template messages using protocol version
`TEMPLATE_MESSAGE_PROTOCOL_VERSION` = `1`, where every message is an object discriminated by `type`
and unknown properties are rejected. Host-to-template messages SHALL be:

- `INIT` with `protocolVersion` `1`, `payload` (an object of JSON values), `context` containing
  exactly `locale` (2 to 35 characters) and `prefersReducedMotion` (boolean), and `assets` (an
  object mapping asset ids of 1 to 160 characters to URLs, defaulting to `{}`).
- `PLAY`, `PAUSE` and `DESTROY`, each with no other properties.

Template-to-host events SHALL be:

- `READY` with `protocolVersion` `1`.
- `SCENE` with `sceneId` of 1 to 80 characters.
- `COMPLETE` with no other properties.
- `ERROR` with `code` `INVALID_MESSAGE` or `RUNTIME_ERROR`.
- `ISSUE` (optional for templates) with `protocolVersion` `1`, `code` `ASSET_UNAVAILABLE` or
  `CONTENT_MISSING`, `fieldId` (a lowercase kebab-case field id of 1 to 80 characters) and an
  optional `itemIndex` (an integer from 0 to 29). An `ISSUE` reports content that the template
  could not show: a referenced image without a usable URL (`ASSET_UNAVAILABLE`) or a required value
  that is missing (`CONTENT_MISSING`). It MUST NOT carry gift content.

Adding `ISSUE` does not change the protocol version: templates that never send it stay conforming.
The host SHALL send `INIT` with `locale` `vi-VN`.

#### Scenario: Valid event

- **WHEN** the template posts `{ "type": "COMPLETE" }`
- **THEN** the host accepts it as a `COMPLETE` event

#### Scenario: Event with extra data

- **WHEN** the template posts `{ "type": "COMPLETE", "privateData": "x" }`
- **THEN** the host rejects the message

#### Scenario: Wrong protocol version

- **WHEN** the template posts `READY` with a `protocolVersion` other than `1`
- **THEN** the host rejects the message

#### Scenario: Valid issue

- **WHEN** the template posts `{ "protocolVersion": 1, "type": "ISSUE", "code": "ASSET_UNAVAILABLE",
"fieldId": "memories", "itemIndex": 1 }`
- **THEN** the host accepts it as an `ISSUE` event

#### Scenario: Malformed issue

- **WHEN** the template posts an `ISSUE` with `code` `BROKEN`, with `itemIndex` `-1` or `1.5`, with a
  `fieldId` of `Memories`, without `protocolVersion`, or with an extra property such as `caption`
- **THEN** the host rejects the message

### Requirement: Lifecycle control

The system SHALL let the viewer drive the runtime with `PLAY`, `PAUSE` and `DESTROY` commands and
SHALL reflect the latest valid event type other than `ISSUE` as the Viewer status, showing
`Runtime error: {code}` for an `ERROR` event. A valid `ISSUE` event MUST be recorded in the event
log without changing the Viewer status. `DESTROY` MUST stop the host from listening for further
template events and release any audio. When the Viewer is unmounted, the host MUST send `DESTROY`
and stop listening. A host other than the diagnostic Viewer harness MUST send `PLAY` only after it
has received `READY`. A conforming template SHALL go `READY` → (`PLAY`) → `SCENE` → `COMPLETE`,
MAY send `ISSUE` events after `READY`, and SHALL answer a malformed `INIT` with `ERROR` code
`INVALID_MESSAGE`. For a `PLAY` received before a valid `INIT`, a conforming template SHALL do one
of two things. It SHALL either answer with `ERROR` code `INVALID_MESSAGE`, as the reference
template does, or hold the `PLAY` until its first valid `INIT` without sending `ERROR`, as
`memory-box` does.

#### Scenario: Full lifecycle

- **WHEN** the Viewer shows `READY` and the user presses `Phát`, then `Hủy runtime`
- **THEN** the status becomes `COMPLETE` after the template completes, then `DESTROY`

#### Scenario: Play before initialization

- **WHEN** the reference template receives `PLAY` before a valid `INIT`
- **THEN** it responds with `ERROR` code `INVALID_MESSAGE` and the Viewer shows
  `Runtime error: INVALID_MESSAGE`

#### Scenario: Pause cancels completion

- **WHEN** the reference template receives `PAUSE` after `PLAY` but before completing
- **THEN** it does not emit `COMPLETE` for that play

#### Scenario: Issue does not change the status

- **WHEN** the Viewer shows `READY` and a valid `ISSUE` event arrives from the iframe
- **THEN** the status stays `READY` and the issue appears in the event log

### Requirement: Viewer harness route

The system SHALL serve a Viewer harness at `/viewer/{templateId}/{version}` for an artifact that
exists at that exact version, running the fixture named by the `fixture` query parameter (default
`default`) and linking every available fixture in a navigation labelled `Fixture Viewer`. A fixture
consists of a payload and optional asset URLs. The harness SHALL send the fixture's asset URLs as
the `INIT` `assets`, or `{}` when the fixture has none. The harness MUST return the not-found page
for an unknown template version or an unknown fixture name.

It SHALL provide these controls:

- play (`Phát`), pause (`Tạm dừng`) and destroy (`Hủy runtime`);
- a mobile/desktop viewport toggle, where the mobile viewport frames the iframe in a portrait 9:16
  aspect ratio;
- the reduced-motion switch.

It SHALL display:

- the status;
- the count and log of valid events (the most recent 20);
- the number of distinct `ISSUE` events, keyed by `code`, `fieldId` and `itemIndex`, received
  since the payload or context last changed, as `Vấn đề nội dung: {n}`. `INIT` messages resent
  during the handshake or on iframe load do not reset it;
- the elapsed milliseconds to `READY` and to `COMPLETE`.

The harness page SHALL be served with the per-request nonce CSP (`strict-dynamic`).

#### Scenario: Reference template fixtures

- **WHEN** a visitor opens `/viewer/memory-box-spike/0.1.0`
- **THEN** the `Fixture Viewer` navigation lists three fixtures (`default`, `max-length`,
  `missing-fields`), the status reaches `READY`, and `INIT` carries `assets` `{}`

#### Scenario: Fixture with asset URLs

- **WHEN** a visitor opens `/viewer/memory-box/1.1.0`
- **THEN** `INIT` carries the `default` fixture's `data:` image URLs in `assets`, and the harness
  shows `Vấn đề nội dung: 0` after `READY`

#### Scenario: Repeated issues are counted once

- **WHEN** the template sends the same `ISSUE` (`ASSET_UNAVAILABLE`, `memories`, `1`) twice because
  it received `INIT` twice
- **THEN** the harness shows `Vấn đề nội dung: 1` and logs both events

#### Scenario: Unknown version or fixture

- **WHEN** a visitor opens `/viewer/memory-box-spike/9.9.9` or
  `/viewer/memory-box-spike/0.1.0?fixture=unknown`
- **THEN** the not-found page is rendered
