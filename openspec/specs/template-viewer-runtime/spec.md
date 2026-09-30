# Template Viewer Runtime

## Purpose

The Viewer runtime executes one exact template artifact inside a sandboxed iframe and drives it
through a versioned, schema-validated host↔template message protocol. It covers the iframe
isolation, the protocol messages, lifecycle control, visibility pause, reduced motion, user-gesture
audio, asset URL injection, the diagnostic Viewer harness, and the SDK runtime interface for
template authors. Artifact URLs and headers are specified by `template-artifact-delivery`.

## Requirements

### Requirement: Sandboxed opaque-origin iframe

The system SHALL execute a template artifact only inside an iframe with `sandbox="allow-scripts"`
and no other sandbox tokens, so the artifact runs with an opaque origin and cannot read the host's
cookies, storage or DOM, navigate the top window, open popups or submit forms. The iframe `src`
MUST be the content-addressed artifact entry URL
`/template-artifacts/{templateId}/{version}/{contentHash}/index.html` of the exact version being
viewed.

#### Scenario: Viewer iframe isolation

- **WHEN** the Viewer renders `memory-box-spike` version `0.1.0`
- **THEN** the iframe titled `LoveMemory template viewer` has `sandbox` exactly `allow-scripts`
- **AND** its `src` pins the template id, version and `contentHash`

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

### Requirement: Trusted event source

The system SHALL accept a template event only when the message's source is the exact
`contentWindow` of the Viewer's iframe and the message data satisfies the template event schema.
Messages from any other window, and messages that fail validation, MUST be ignored without
changing Viewer state.

#### Scenario: Event from the iframe window

- **WHEN** a schema-valid `READY` event arrives from the Viewer iframe's window
- **THEN** the host records it and updates its status to `READY`

#### Scenario: Event from another window

- **WHEN** a schema-valid `READY` event arrives from any other window
- **THEN** the host ignores it

### Requirement: Initialization handshake

The system SHALL send `INIT` to the iframe after mount and on every iframe load, and SHALL resend
`INIT` every 250 ms until a `READY` event is received, up to 20 attempts in total. When 20 attempts
pass without `READY`, the host MUST stop resending and report the status `INIT timeout`. Receiving
`READY` MUST stop the resend timer.

#### Scenario: Template becomes ready

- **WHEN** the artifact answers an `INIT` with `READY`
- **THEN** the host stops resending `INIT` and shows the status `READY`

#### Scenario: Template never becomes ready

- **WHEN** no `READY` event arrives after 20 `INIT` attempts
- **THEN** the host stops resending and shows the status `INIT timeout`

### Requirement: Lifecycle control

The system SHALL let the viewer drive the runtime with `PLAY`, `PAUSE` and `DESTROY` commands and
SHALL reflect the latest valid event type as the Viewer status, showing `Runtime error: {code}` for
an `ERROR` event. `DESTROY` MUST stop the host from listening for further template events and
release any audio. When the Viewer is unmounted, the host MUST send `DESTROY` and stop listening.
A conforming template SHALL go `READY` → (`PLAY`) → `SCENE` → `COMPLETE`, and SHALL answer `PLAY`
received before a valid `INIT`, or a malformed `INIT`, with `ERROR` code `INVALID_MESSAGE`.

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

### Requirement: Pause when the page is hidden

The system SHALL, when the host document becomes hidden (`visibilitychange` with `document.hidden`
true), send `PAUSE` to the template, pause any playing audio, and show the status
`PAUSE · tab ẩn`.

#### Scenario: Tab hidden during playback

- **WHEN** the viewer switches to another tab while the template is playing
- **THEN** the host sends `PAUSE` and pauses audio

### Requirement: Reduced motion

The system SHALL set `INIT` `context.prefersReducedMotion` to `true` when the user's system matches
`(prefers-reduced-motion: reduce)` or the Viewer's reduced-motion switch is on. Toggling the switch
MUST immediately resend `INIT` with the new value. The reference template SHALL complete
immediately after `PLAY` when reduced motion is requested, and after 700 ms otherwise.

#### Scenario: Switch enabled

- **WHEN** the user turns the reduced-motion switch on
- **THEN** the host resends `INIT` with `prefersReducedMotion` `true`

#### Scenario: System preference

- **WHEN** the operating system requests reduced motion and the switch is off
- **THEN** `INIT` is sent with `prefersReducedMotion` `true`

### Requirement: Audio only after a user gesture

The system SHALL NOT start audio automatically. When an audio source is supplied to the Viewer, it
SHALL be loaded with `preload="none"` and play only inside the handler of the user's `Phát` action.
Playback results SHALL be classified as `playing`, `blocked` (the browser's autoplay policy
rejected playback with `NotAllowedError`) or `failed` (any other error); for `blocked` or `failed`
the Viewer MUST keep the template running and show `PLAY · audio {result}` as a visible fallback.
Destroying the runtime MUST pause the audio, remove its source and reset the element.

#### Scenario: Autoplay policy blocks playback

- **WHEN** the user presses `Phát` and the browser rejects audio playback with `NotAllowedError`
- **THEN** the template still receives `PLAY` and the Viewer shows `PLAY · audio blocked`

#### Scenario: Audio decode failure

- **WHEN** audio playback fails for any other reason
- **THEN** the Viewer shows `PLAY · audio failed`

#### Scenario: No gesture, no audio

- **WHEN** the Viewer loads and the user has not pressed `Phát`
- **THEN** no audio playback is attempted

### Requirement: Asset URL allowlist injection

The system SHALL give a template access to media only through the `INIT` `assets` map of asset id
to URL supplied by the host; image fields in the payload carry asset ids, never URLs (see
`template-manifest-contract`). The template CSP limits image sources to `data:`, the private blob
origin and the configured asset origin. A conforming
template SHALL render an image only when its asset id is present in `assets`, ignoring ids without
an injected URL. When the host supplies no asset URLs, `assets` MUST be sent as `{}`.

#### Scenario: Asset id without injected URL

- **WHEN** the payload's image list references an asset id that is not a key of `assets`
- **THEN** the reference template does not render that image

#### Scenario: No asset URLs supplied

- **WHEN** the Viewer is rendered without asset URLs
- **THEN** `INIT` carries `assets` `{}`

### Requirement: Viewer harness route

The system SHALL serve a Viewer harness at `/viewer/{templateId}/{version}` for an artifact that
exists at that exact version, running the fixture named by the `fixture` query parameter (default
`default`) and linking every available fixture in a navigation labelled `Fixture Viewer`. The
harness MUST return the not-found page for an unknown template version or an unknown fixture name.
It SHALL provide controls for play (`Phát`), pause (`Tạm dừng`), destroy (`Hủy runtime`), a
mobile/desktop viewport toggle and the reduced-motion switch, and SHALL display the status, the count
and log of valid events (the most recent 20), and the elapsed milliseconds to `READY` and to
`COMPLETE`. The harness page SHALL be served with the per-request nonce CSP (`strict-dynamic`).

#### Scenario: Reference template fixtures

- **WHEN** a visitor opens `/viewer/memory-box-spike/0.1.0`
- **THEN** the `Fixture Viewer` navigation lists three fixtures (`default`, `max-length`,
  `missing-fields`) and the status reaches `READY`

#### Scenario: Unknown version or fixture

- **WHEN** a visitor opens `/viewer/memory-box-spike/9.9.9` or
  `/viewer/memory-box-spike/0.1.0?fixture=unknown`
- **THEN** the not-found page is rendered

### Requirement: SDK runtime interface

The template SDK SHALL define the runtime contract a template implements: `mount(root, payload,
context)` returning a promise, `play()` returning a promise, `pause()`, `destroy()`, and an optional
`seek(sceneId)`. The runtime context MUST provide `locale`, `prefersReducedMotion`,
`reportScene(sceneId)`, `resolveAsset(assetId, width)` returning a URL string, and an abort
`signal`.

#### Scenario: Optional seek

- **WHEN** a template runtime omits `seek`
- **THEN** it still satisfies the runtime contract
