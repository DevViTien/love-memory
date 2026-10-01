# Spec Delta

## Purpose

Defines the reusable host that presents stored gift content to a person: the envelope and its
tap-to-open gesture, a content source that is either ready or loaded on tap, audio and mute, the
sandboxed template runtime, pause and resume around page visibility, the collection of template
issues, lifecycle notifications, and the static fallback that keeps all content readable when the
template fails. Preview uses it now, and the published Viewer is meant to reuse it. Its input
comes from `viewer-payload`, and the protocol from `template-viewer-runtime`.

## ADDED Requirements

### Requirement: Content source

The gift viewer SHALL accept its content from one of two sources:

- **Ready source.** The viewer payload is available when the gift viewer mounts. Preview uses
  this source.
- **Deferred source.** The gift viewer receives only a function that loads the viewer payload,
  and it calls that function only when the person chooses `Mở quà`. This lets a page render the
  envelope without any gift content.

With a deferred source, the gift viewer MUST NOT render gift content, request asset URLs or create
the template iframe before the load has succeeded. When the load fails, the gift viewer SHALL show
`Chưa mở được món quà. Hãy kiểm tra kết nối và thử lại.` with a `Thử lại` button. `Thử lại` runs the
load again, inside its own gesture. A failed load MUST NOT show any partial content.

#### Scenario: Ready source loads behind the envelope

- **WHEN** the gift viewer mounts with a ready source
- **THEN** the template iframe loads and completes its handshake while the envelope is shown

#### Scenario: Deferred source loads on tap

- **WHEN** the gift viewer mounts with a deferred source
- **THEN** no load is called, no iframe exists and no gift content is in the document
- **AND** choosing `Mở quà` calls the load once, then creates the iframe with the loaded payload

#### Scenario: Deferred load fails

- **WHEN** the load of a deferred source fails
- **THEN** `Chưa mở được món quà. Hãy kiểm tra kết nối và thử lại.` and `Thử lại` are shown, and no
  gift content is shown
- **AND** choosing `Thử lại` calls the load again, and a successful load opens the gift

### Requirement: Envelope and opening gesture

The gift viewer SHALL start with an envelope. The envelope is a host-rendered cover with the
heading `Bạn có một món quà` and a native button `Mở quà`, and it shows no gift content. With a
ready source, the gift viewer SHALL already load the template iframe and complete the
initialization handshake behind the envelope. The iframe is hidden from assistive technology and
does not receive focus.

The gift viewer SHALL set the iframe's artifact URL only after its client-side `load` listener is
attached. That way a `load` event, even of a cached artifact, is never missed. A `load` event while
the iframe's `src` attribute is not that artifact URL, such as the load of the initial
`about:blank` document, SHALL be ignored: it neither ends the 15-second load wait nor starts the
handshake.

Choosing `Mở quà` SHALL do three things:

- remove the envelope;
- start audio inside that gesture handler, as described in "Audio playback and mute";
- send `PLAY` to the template as soon as the template has answered `READY`.

A `PLAY` MUST NOT be sent before `READY`. If `READY` has not arrived yet, or the deferred load is
still running, the gift viewer SHALL show `Đang mở quà…` and send `PLAY` when `READY` arrives.
After opening, keyboard focus SHALL move to the template frame, or to the static content when the
fallback is shown. When the static rendering replaces the template after opening, focus SHALL move
to the static content.

#### Scenario: Open a ready template

- **WHEN** the template has answered `READY` and the person chooses `Mở quà`
- **THEN** the envelope disappears and the host sends `PLAY` once

#### Scenario: Tap before the template is ready

- **WHEN** the person chooses `Mở quà` before `READY`
- **THEN** `Đang mở quà…` is shown, no `PLAY` is sent, and `PLAY` is sent right after `READY` arrives

#### Scenario: Initial blank document load

- **WHEN** the iframe fires `load` for its initial `about:blank` document after the artifact URL
  was assigned but before the artifact document loaded
- **THEN** no `INIT` is sent for that load and the 15-second load wait keeps running

#### Scenario: Cached artifact on reload

- **WHEN** the page that holds the gift viewer is reloaded and the artifact is served from the
  browser cache
- **THEN** the template still answers `READY`, and choosing `Mở quà` plays the gift without
  falling back to the static rendering

#### Scenario: Nothing plays without the gesture

- **WHEN** the gift viewer has loaded and the person has not chosen `Mở quà`
- **THEN** no `PLAY` has been sent and no audio playback has been attempted

### Requirement: Audio playback and mute

The gift viewer SHALL use one audio element with `preload="none"`, and SHALL start playback only
inside the handler of `Mở quà`, `Thử lại` or `Tiếp tục`.

- **Ready source.** When the payload has an `audioUrl`, the element carries that source, and the
  gift viewer calls playback inside the `Mở quà` handler.
- **Deferred source.** The `audioUrl` is not known at tap time. Inside the `Mở quà` or `Thử lại`
  handler, the gift viewer SHALL call playback on the element, which has no source yet, so that
  the browser allows later playback. It SHALL set the source and start playback once the load
  returns an `audioUrl`.

When playback is blocked or fails, the gift viewer MUST keep the template running and show the
notice `Không phát được nhạc.`. After opening, a toggle button SHALL mute and unmute the audio. It
reads `Tắt tiếng` while sound is on and `Bật tiếng` while muted, and it exposes its state with
`aria-pressed`. The muted state SHALL be kept when the gift is restarted on the same page. When the
payload's `audioUrl` is `null`, the gift viewer SHALL show no mute control and start no playback.

#### Scenario: Audio starts with the opening gesture

- **WHEN** a ready source has an `audioUrl` and the person chooses `Mở quà`
- **THEN** audio playback is requested inside that click handler

#### Scenario: Deferred audio after the load

- **WHEN** a deferred source's load returns an `audioUrl` after the person chose `Mở quà`
- **THEN** the audio element was unlocked inside the click handler, and playback of that
  `audioUrl` starts without another gesture

#### Scenario: Autoplay policy blocks audio

- **WHEN** the browser rejects playback with `NotAllowedError`
- **THEN** the template still receives `PLAY` and the notice `Không phát được nhạc.` is shown

#### Scenario: Mute

- **WHEN** audio is playing and the person chooses `Tắt tiếng`
- **THEN** the audio is muted, and the button reads `Bật tiếng` with `aria-pressed="true"`

#### Scenario: Gift without music

- **WHEN** the payload's `audioUrl` is `null`
- **THEN** there is no mute control, no audio source is set, and the gift plays normally

### Requirement: Pause and resume with page visibility

When the page becomes hidden after the gift was opened and before `COMPLETE`, the gift viewer SHALL
send `PAUSE` to the template and pause the audio. When the page is visible again, it SHALL show a
`Tiếp tục` button and MUST NOT resume by itself. Choosing `Tiếp tục` SHALL send `PLAY` and resume
the audio inside that gesture. A page hidden before opening or after `COMPLETE` SHALL only pause the
audio.

This includes a page hidden while the gift is still opening (`Đang mở quà…`, after `Mở quà` and
before the template or the static rendering started). The gift viewer SHALL pause the audio, and
when `READY`, the deferred load or a fallback arrives later, it MUST NOT send `PLAY` or start the
audio; it SHALL show `Tiếp tục` instead, which starts the gift as above.

#### Scenario: Switch apps during the gift

- **WHEN** the person switches to another app during `memory-2` and comes back
- **THEN** the template received `PAUSE`, the audio is paused, and `Tiếp tục` is shown
- **AND** choosing `Tiếp tục` sends `PLAY` and resumes the audio

#### Scenario: Hidden while opening

- **WHEN** the person chooses `Mở quà` before `READY` (or before a deferred load finished) and
  switches to another app before `READY` arrives
- **THEN** no `PLAY` is sent and no audio plays when `READY` arrives, and `Tiếp tục` is shown
- **AND** choosing `Tiếp tục` sends `PLAY` and starts the audio

#### Scenario: Hidden before opening

- **WHEN** the page is hidden while the envelope is still shown
- **THEN** no `PAUSE` is sent and the envelope is still shown on return

### Requirement: Reduced motion

The gift viewer SHALL send `INIT` with `context.prefersReducedMotion` `true` when the system
requests reduced motion, or when its host page forces reduced motion. The envelope and the static
fallback SHALL use no animation in that case.

#### Scenario: Forced reduced motion

- **WHEN** the host page forces reduced motion on a system without that preference
- **THEN** `INIT` carries `prefersReducedMotion` `true`

### Requirement: Static fallback keeps the content

The gift viewer SHALL replace the template with a host-rendered static rendering of the content in
any of these cases:

- the payload's `artifactUrl` is `null`;
- the template sends a valid `ERROR` event of either code, before or after opening;
- no `READY` arrives within 20 `INIT` attempts after the iframe's latest `load` event;
- the iframe fires no `load` event within 15 seconds of receiving its artifact URL.

On switching, the gift viewer SHALL send `DESTROY`, remove the iframe and stop listening to it. It
SHALL keep any audio that is already playing. The switch is final for that mount.

The static rendering SHALL show every field of `fields` that has a value, in declaration order,
without labels or animation:

- `shortText` and `longText` values as text, keeping line breaks;
- `date` values as `DD/MM/YYYY`;
- each image item as its image, from the `assets` URL with no referrer, followed by its caption.
  When the image has no URL or fails to load, the caption is shown instead, or `Ảnh {n}` when
  there is no caption.

`theme` and `audio` values SHALL NOT be rendered as text. All values MUST be rendered as text, never
as HTML. If the fallback happens before opening, the envelope SHALL stay until the person chooses
`Mở quà`.

Asset URLs expire at the payload's `assetsExpireAt`. The gift viewer SHALL get fresh asset URLs
once, and then render or retry the static images with them, in two cases:

- the static rendering is first shown at or after `assetsExpireAt`;
- one of its images fails to load at or after that time.

With a deferred source it gets them by calling the load again. With a ready source it asks its
host page to refresh the payload, without resetting the gift. An image that still fails shows its
caption.

#### Scenario: Template runtime error

- **WHEN** the template sends `ERROR` with code `RUNTIME_ERROR` during `memory-2`
- **THEN** the iframe is removed after `DESTROY`, and the page shows the receiver name, the
  formatted date, the opening message, every photo with its caption, and the final letter

#### Scenario: Template never becomes ready

- **WHEN** the iframe loads but no `READY` arrives after 20 `INIT` attempts
- **THEN** the static rendering replaces the template

#### Scenario: No artifact

- **WHEN** `artifactUrl` is `null` and the person chooses `Mở quà`
- **THEN** no iframe is created and the static rendering is shown

#### Scenario: Fallback after the asset URLs expired

- **WHEN** the template fails 6 minutes after the payload was built, so its asset URLs have expired
- **THEN** the gift viewer gets fresh asset URLs once, and the static rendering shows the photos
  with them, without returning to the envelope

#### Scenario: Markup in content

- **WHEN** the static rendering shows a `receiver-name` of `<img src=x onerror=alert(1)>`
- **THEN** that string appears as text and no element is created from it

### Requirement: Template issue collection

The gift viewer SHALL accept `ISSUE` events only under the trusted-event rules of
`template-viewer-runtime`. It SHALL report to its host page the set of distinct issues, keyed by
`code`, `fieldId` and `itemIndex`, received since the template was last initialized with different
content or context. Repeated `INIT` messages of the handshake MUST NOT reset or duplicate the set.
An `ISSUE` MUST NOT change the playback state.

#### Scenario: Duplicate issues

- **WHEN** the template sends the same `ISSUE` (`ASSET_UNAVAILABLE`, `memories`, `1`) twice
- **THEN** the host page receives one issue for that key

#### Scenario: Issue from another window

- **WHEN** a schema-valid `ISSUE` arrives from a window other than the gift viewer's iframe
- **THEN** it is ignored

### Requirement: Lifecycle notifications

The gift viewer SHALL report its lifecycle to its host page through one notification channel:

- `opened`, when the person chooses `Mở quà` and the content is available;
- `scene`, with the `sceneId`, for each valid `SCENE` event;
- `completed`, for the first `COMPLETE` of a play-through;
- `fallback`, with the reason (`ERROR`, `INIT_TIMEOUT`, `LOAD_TIMEOUT` or `NO_ARTIFACT`), when it
  switches to the static rendering.

Notifications MUST NOT carry gift content. The gift viewer itself MUST NOT send them anywhere; the
host page decides. An unmounted gift viewer MUST NOT notify, including a `NO_ARTIFACT` fallback
detected while it was mounting (a development double mount reports it once). The preview page MUST NOT turn these notifications into recipient events such
as analytics of gift opening.

#### Scenario: Full play-through notifications

- **WHEN** a person opens a gift and the template sends `SCENE` `opening`, `SCENE` `memory-1` and
  `COMPLETE`
- **THEN** the host page is notified `opened`, `scene` `opening`, `scene` `memory-1` and `completed`
  in that order

#### Scenario: Fallback notification

- **WHEN** the template sends `ERROR` after opening
- **THEN** the host page is notified `fallback` with reason `ERROR`, and no notification contains
  gift text
