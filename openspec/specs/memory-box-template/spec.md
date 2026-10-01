# memory-box-template Specification

## Purpose

"Hộp ký ức" (`memory-box`) is the first launch template. A recipient opens a closed box, sees the
creator's photos one by one with their captions, reads a final letter and reaches a closing card.
This capability specifies release `1.1.0`: its manifest, the observable behavior of its artifact
inside the sandboxed Viewer, and the fixtures it ships for the Viewer harness.

## Requirements

### Requirement: Release manifest

The system SHALL provide the template release `memory-box` version `1.1.0` from the workspace
`templates/memory-box`, with `engineVersion` `1.0.0`, `status` `published`, `entry` `index.html`,
`previewFixture` `preview.fixture.json`, `meta.name` `Hộp ký ức`, `capabilities` `audio` and `dom`,
and `budgets` `initialJsKbGzip` `60`, `initialMediaKb` `0` and `maxTextureMb` `1`. Its fields SHALL
be, in this order:

| Field id           | Type                 | Rules                                                               |
| ------------------ | -------------------- | ------------------------------------------------------------------- |
| `receiver-name`    | `shortText`          | `maxLength` 40, required                                            |
| `anniversary-date` | `date`               | optional                                                            |
| `opening-message`  | `shortText`          | `maxLength` 120, required                                           |
| `memories`         | `captionedImageList` | `aspectRatio` `4:5`, 3 to 8 items, `captionMaxLength` 140, required |
| `final-letter`     | `longText`           | `maxLength` 1200, required                                          |
| `theme`            | `theme`              | `options` `rose-night`, `warm-paper`; optional                      |
| `audio`            | `audio`              | `source` `licensedLibrary`; optional                                |

Its `steps` SHALL be, in this order:

- `recipient` (`Người nhận`): `receiver-name`, `anniversary-date`
- `opening` (`Lời mở hộp`): `opening-message`
- `memories` (`Kỷ niệm`): `memories`
- `letter` (`Lá thư`): `final-letter`
- `style` (`Giao diện & nhạc`): `theme`, `audio`

The manifest MUST pass `template-manifest-contract` validation, and its preview fixture MUST pass
full payload validation against it.

#### Scenario: Manifest resolves to the storyboard steps

- **WHEN** the `memory-box` `1.1.0` manifest is parsed and its steps are resolved
- **THEN** the steps are `recipient`, `opening`, `memories`, `letter` and `style` in that order,
  and every field belongs to exactly one of them

#### Scenario: Payload outside the contract

- **WHEN** full payload validation runs for `memory-box` `1.1.0` on content with 2 memories, 9
  memories, a caption of 141 characters, or a `theme` of `ocean`
- **THEN** validation fails

### Requirement: Artifact constraints

The system SHALL build the `memory-box` `1.1.0` artifact as an entry document `index.html` and one
self-contained ES module `runtime.mjs` that imports no other module. The measured
`initialJsKbGzip` MUST be at most `60`. The runtime MUST NOT use network, storage, worker or media
APIs: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`,
`localStorage`, `sessionStorage`, `indexedDB`, `Worker`, or `<audio>` or `<video>` elements. The
template MUST render every gift value as text, never as HTML. Audio is never played by the
template. The host plays it, and the template shows no audio controls.

The served bytes of `memory-box` `1.1.0` MUST be the committed release files in
`templates/memory-box/releases/1.1.0/`, never a rebuild from source. Once released, those files
and their `contentHash` MUST NOT change, whatever happens to the template source or the build
toolchain. Any change to the artifact bytes MUST ship as a new template version with its own
release directory. The SHA-256 of every committed release file SHALL be recorded when the version is
released, and while `template.manifest.json` has the released version, the release's
`manifest.json` MUST be canonically equal to it.

#### Scenario: Runtime within budget

- **WHEN** `templates/memory-box` is built
- **THEN** `dist/build-metrics.json` has `initialJsKbGzip` of at most `60` and the CI template gate
  passes

#### Scenario: Forbidden API in the bundle

- **WHEN** the bundled runtime contains any of the forbidden network, storage, worker or media APIs
- **THEN** the template build fails naming the forbidden API

#### Scenario: Toolchain upgrade after release

- **WHEN** a build toolchain upgrade makes the source build produce different bytes after
  `memory-box` `1.1.0` was released
- **THEN** the artifact served for `memory-box` `1.1.0` is unchanged and keeps its released
  `contentHash`

#### Scenario: Released files edited

- **WHEN** any committed file of the `memory-box` `1.1.0` release is modified, even together with
  its `artifact.json`
- **THEN** the test suite fails because that file's SHA-256 no longer equals the value recorded at
  release, and, for `index.html` or `runtime.mjs`, because the `contentHash` no longer equals the
  released value

#### Scenario: Release manifest edited

- **WHEN** only `templates/memory-box/releases/1.1.0/manifest.json` is modified, for example a
  field label
- **THEN** the test suite fails, although the `contentHash` is unchanged

#### Scenario: Markup in gift text

- **WHEN** `receiver-name` is `<img src=x onerror=alert(1)>`
- **THEN** the cover shows that string literally and the document contains no element created from
  it

### Requirement: Initialization and cover

The template SHALL show a neutral loading state without any gift content until it accepts an
`INIT`. On a valid `INIT` it SHALL render the cover scene (`cover`):

- the closed box;
- the heading `Gửi {receiver-name}`;
- the `anniversary-date`, when present, formatted as `DD/MM/YYYY`;
- the selected theme.

It SHALL then send `READY` with `protocolVersion` `1`, followed by any content issues. The cover
MUST NOT contain an open control, because the host owns the opening gesture. The template MUST NOT
send a `SCENE` event for the cover.

A later valid `INIT` whose payload, assets and context are all deep-equal to the current ones
SHALL only be answered with `READY`. It MUST NOT reset the scene, re-render or re-send issues. Any
other later valid `INIT` SHALL replace the payload, the asset URLs and the context, stop any
running scene, render the cover again and send `READY` again.

A malformed `INIT` MUST be answered with `ERROR` code `INVALID_MESSAGE` and change nothing. A
`PLAY` received before any valid `INIT` MUST NOT be answered with `ERROR`. The template SHALL hold
it, and start the scene sequence right after the first valid `INIT` and its `READY`. Messages
whose source is not the parent window MUST be ignored.

#### Scenario: Cover after INIT

- **WHEN** the template receives a valid `INIT` whose payload has `receiver-name` `An` and
  `anniversary-date` `2024-09-15`
- **THEN** it shows the closed box, the heading `Gửi An` and `15/09/2024`, and sends `READY`
- **AND** no `SCENE` event is sent before `PLAY`

#### Scenario: Different INIT during playback

- **WHEN** the template is showing `memory-2` and receives a valid `INIT` whose context has a
  different `prefersReducedMotion`
- **THEN** it stops the running scene, shows the cover again and sends `READY`

#### Scenario: Identical INIT resent

- **WHEN** the template, after sending `READY` and two `ISSUE` events, receives an `INIT`
  deep-equal to the current one
- **THEN** it sends `READY` only, stays in its current scene and sends no `ISSUE` again

#### Scenario: Malformed INIT

- **WHEN** the template receives an `INIT` without `context`
- **THEN** it sends `ERROR` with code `INVALID_MESSAGE` and keeps its current state

#### Scenario: PLAY before INIT

- **WHEN** the template receives `PLAY` and then its first valid `INIT`
- **THEN** it sends no `ERROR`, sends `READY`, then starts the sequence with `SCENE` `opening`

### Requirement: Scene sequence and controls

The template SHALL, on `PLAY` from the cover, run these scenes in order and send
`SCENE { sceneId }` as each one starts:

- `opening`: the lid opens and `opening-message` appears.
- `memory-1` … `memory-n`: one scene per `memories` item, in order.
- `letter`
- `finale`

It SHALL send `COMPLETE` exactly once per play-through, when the `finale` has settled. A scene
whose content is entirely absent MUST be skipped: the memory scenes when there are no memories,
and `letter` when there is no `final-letter`. The cover and `finale` always run.

Timing:

- `opening` advances after 5 seconds.
- Each memory scene advances after 6 seconds.
- `letter` waits for the recipient.
- `finale` sends `COMPLETE` 1.2 seconds after it starts.

The `opening`, memory and `letter` scenes SHALL show a `Tiếp` button that advances immediately.

`PAUSE` MUST freeze timers and animations, and disable `Tiếp`. The next `PLAY` SHALL resume the
current scene, not restart it. `PAUSE` on the cover or after `COMPLETE` MUST freeze the running
animations too: the cover's breathing, or the settling finale. On the cover the next `PLAY` starts
the sequence as usual. A `PLAY` while playing or after `COMPLETE` MUST NOT start or advance any
scene or send any event; after `COMPLETE` it only resumes the frozen animations.
`DESTROY` MUST stop all timers, remove the rendered content and stop handling messages.

#### Scenario: Full play-through

- **WHEN** the template is initialized with 3 memories and a `final-letter`, receives `PLAY`, and
  the recipient presses `Tiếp` in every scene
- **THEN** it sends `SCENE` `opening`, `memory-1`, `memory-2`, `memory-3`, `letter` and `finale`
  in that order, then `COMPLETE` once

#### Scenario: Letter waits for the recipient

- **WHEN** the `letter` scene has been shown for 60 seconds without `Tiếp` being pressed
- **THEN** `finale` has not started and no `COMPLETE` has been sent

#### Scenario: Automatic advance

- **WHEN** `memory-1` has been shown for 6 seconds without interaction
- **THEN** the template sends `SCENE` `memory-2`

#### Scenario: Pause and resume

- **WHEN** the template receives `PAUSE` during `memory-2` and stays paused for 30 seconds, then
  receives `PLAY`
- **THEN** no scene advances and `Tiếp` is disabled while paused, and playback resumes at
  `memory-2`

#### Scenario: Pause on the cover

- **WHEN** the template shows the cover without reduced motion and receives `PAUSE`
- **THEN** the cover's breathing animation is frozen and no `SCENE` event is sent
- **AND** when it then receives `PLAY`, the animation is no longer frozen and it sends `SCENE`
  `opening`

#### Scenario: Pause before completion

- **WHEN** the template receives `PAUSE` during `finale` before `COMPLETE` was sent
- **THEN** it does not send `COMPLETE` until it receives `PLAY` again

#### Scenario: Missing letter and memories

- **WHEN** the payload has no `memories` and no `final-letter` and the template receives `PLAY`
- **THEN** it sends `SCENE` `opening` and `finale`, then `COMPLETE`

### Requirement: Memory cards and image fallback

Each memory scene SHALL show that item's photo in a 4:5 frame that it fills without distortion, for
both portrait and landscape photos, with the item's `caption` below it. When the frame is short,
the photo frame SHALL shrink, keeping 4:5, so that the caption and `Tiếp` stay visible. The photo's alternative
text SHALL be the caption, or `Kỷ niệm {n}` when there is no caption. The template SHALL load a
photo only from the URL that `INIT` `assets` supplies for the item's `assetId`, with no referrer.
After `READY` it SHALL preload the photos in order, one at a time, without delaying the cover. It
MUST request each photo URL at most once per accepted `INIT`, and show the preloaded image in its
scene without requesting the URL again. Signed URLs can expire before a late scene.

When an item has no string `assetId`, its `assetId` has no URL in `assets`, or its photo fails to
load, the scene MUST show a text card with the caption, or `Kỷ niệm {n}` when there is no caption,
instead of a photo. The template MUST send `ISSUE` code `ASSET_UNAVAILABLE` with `fieldId`
`memories` and that item's zero-based `itemIndex`. At most the first 8 items SHALL be shown.

#### Scenario: Photo with caption

- **WHEN** `memory-1` starts for an item whose `assetId` has a URL in `assets` and whose caption is
  `Đà Lạt 2023 🌲`
- **THEN** the scene shows that photo with the alternative text `Đà Lạt 2023 🌲` and the caption
  below it

#### Scenario: Asset without a URL

- **WHEN** the second memory's `assetId` is not a key of `assets`
- **THEN** after `READY` the template sends `ISSUE` `ASSET_UNAVAILABLE` with `fieldId` `memories`
  and `itemIndex` `1`
- **AND** `memory-2` shows a text card with that item's caption and requests no image

#### Scenario: Late scene after URL expiry

- **WHEN** a photo was preloaded successfully and its URL stops being valid before its memory scene
  starts
- **THEN** the scene shows the preloaded photo, and no second request or `ASSET_UNAVAILABLE` issue
  occurs

#### Scenario: Photo fails to load

- **WHEN** the URL for the third memory cannot be decoded as an image
- **THEN** the template sends `ISSUE` `ASSET_UNAVAILABLE` with `itemIndex` `2`, and `memory-3`
  shows a text card instead of a broken image

### Requirement: Content issues

The template SHALL send `ISSUE` code `CONTENT_MISSING` with the `fieldId` for each required field
(`receiver-name`, `opening-message`, `memories`, `final-letter`) whose value is absent, empty after
trimming, or of the wrong type. It SHALL keep rendering with a neutral fallback:

- the cover heading becomes `Gửi bạn`;
- the `opening` scene shows no message;
- the memory scenes and the `letter` scene are skipped.

Each distinct issue (`code`, `fieldId`, `itemIndex`) MUST be sent at most once per accepted `INIT`,
after `READY`. An issue MUST NOT carry gift text. A missing or unknown `theme`, a missing or invalid
`anniversary-date`, and a missing `audio` are not issues.

#### Scenario: Empty payload

- **WHEN** the template receives a valid `INIT` whose payload is `{}`
- **THEN** it sends `READY` and then `ISSUE` `CONTENT_MISSING` exactly once each for
  `receiver-name`, `opening-message`, `memories` and `final-letter`
- **AND** the cover shows `Gửi bạn`

#### Scenario: Wrong value type

- **WHEN** `final-letter` is the number `42`
- **THEN** the template sends `ISSUE` `CONTENT_MISSING` with `fieldId` `final-letter` and skips the
  `letter` scene

### Requirement: Theme variants

The template SHALL apply the theme named by the `theme` value: `rose-night` (dark) or `warm-paper`
(light). When `theme` is absent or not one of these, it MUST apply `rose-night`. In both themes the
contrast ratio of body text against its background MUST be at least 4.5:1. The contrast of the
`Tiếp` control and its focus indicator against their background MUST be at least 3:1.

#### Scenario: Warm paper theme

- **WHEN** the payload `theme` is `warm-paper`
- **THEN** every scene uses the light `warm-paper` palette

#### Scenario: Unknown theme

- **WHEN** the payload `theme` is `ocean` or absent
- **THEN** the template uses `rose-night` and sends no issue for it

### Requirement: Reduced motion

The template SHALL, when `INIT` `context.prefersReducedMotion` is `true`, use no transforms and no
particles, and stop the cover's breathing motion. Scene changes become immediate or opacity-only,
the letter shows all its paragraphs at once, and `finale` sends `COMPLETE` without the 1.2-second
delay. Automatic advance times for `opening` and the memory scenes MUST stay the same. Without
reduced motion, `finale` SHALL show at most 24 particle elements. No information SHALL appear only
during an animation.

#### Scenario: Reduced-motion finale

- **WHEN** the template was initialized with `prefersReducedMotion` `true` and reaches `finale`
- **THEN** it renders no particle elements and sends `COMPLETE` immediately

#### Scenario: Normal finale

- **WHEN** the template was initialized with `prefersReducedMotion` `false` and reaches `finale`
- **THEN** it renders at most 24 particle elements and sends `COMPLETE` after 1.2 seconds

### Requirement: Runtime error fallback

The template SHALL catch every error thrown while handling a message, rendering a scene or running
a timer, and every uncaught error or unhandled rejection in its document. On the first such error it
MUST do three things:

- replace the stage with a static fallback, without animation, that shows all gift text in reading
  order: the receiver heading, the date, `opening-message`, each caption, then `final-letter`;
- send `ERROR` code `RUNTIME_ERROR` exactly once;
- stop sending `SCENE` and `COMPLETE`.

A later valid `INIT` SHALL start over from the cover.

#### Scenario: Scene rendering throws

- **WHEN** rendering `memory-2` throws an error
- **THEN** the document shows the static fallback containing the receiver heading, the opening
  message, every caption and the final letter
- **AND** the template sends `ERROR` with code `RUNTIME_ERROR` once and no further `SCENE` or
  `COMPLETE`

### Requirement: Accessibility and text layout

The template SHALL present content in a meaningful order with CSS and animation disabled:

- the cover heading is the document's only level-one heading;
- each scene's text follows it in the reading order of the scene sequence;
- the letter text is selectable.

`Tiếp` MUST be a native button with a visible focus indicator and a target of at least 44×44 CSS
pixels, and MUST work from the keyboard. When `Tiếp` has focus and the next scene is shown, focus
SHALL move to that scene's `Tiếp`, or, in the `finale`, to its closing heading, never to the
document body. The scrollable letter region SHALL be keyboard focusable with a visible focus
indicator. The template SHALL use system fonts only. Text at the
maximum field lengths, including Vietnamese diacritics and emoji, MUST wrap inside a 320-CSS-pixel
wide frame without horizontal scrolling. A letter longer than the frame SHALL scroll vertically
inside its scene. In a portrait 9:16 frame at most 320 CSS pixels wide, `Tiếp` MUST lie entirely
inside the frame's viewport in every scene that shows it, at the maximum field lengths.

#### Scenario: Keyboard advance

- **WHEN** focus is on `Tiếp` during `memory-1` and the recipient presses Enter
- **THEN** the template advances to `memory-2`

#### Scenario: Keyboard focus reaches the finale

- **WHEN** focus is on `Tiếp` during `letter` and the recipient presses Enter
- **THEN** the `finale` starts and focus is on its closing heading

#### Scenario: Maximum-length content on a narrow frame

- **WHEN** the `max-length` fixture is rendered in the harness on a page viewport 320 CSS pixels
  wide, so the frame is at most 320 CSS pixels wide
- **THEN** no scene has a horizontal scrollbar and the whole letter is readable by scrolling
  vertically
- **AND** in the `opening`, every memory scene and `letter`, `Tiếp` is fully inside the frame's
  viewport without scrolling

### Requirement: Viewer harness fixtures

The template SHALL ship the Viewer harness fixtures `default`, `max-length`, `missing-fields` and
`broken-image` for release `1.1.0`. Each fixture is a payload plus the asset URLs to send as
`INIT` `assets`. Fixtures SHALL be keyed by release version, and each release's fixtures MUST be
validated against that release's committed `manifest.json`. Harness
images MUST be inline `data:` URLs, never storage URLs. The fixtures are:

- `default`: the release's committed preview fixture payload. It has 5 photos, portrait and landscape, and one of
  them has no caption.
- `max-length`: every text field at its maximum length, 8 photos with 140-character captions, and
  Vietnamese diacritics and emoji.
- `missing-fields`: the payload `{}`.
- `broken-image`: one memory whose `assetId` has no URL, and one whose `data:` URL is not a
  decodable image.

`default`, `max-length` and `broken-image` MUST pass full payload validation. `missing-fields` MUST
pass draft payload validation.

#### Scenario: Harness lists the fixtures

- **WHEN** a visitor opens `/viewer/memory-box/1.1.0`
- **THEN** the `Fixture Viewer` navigation lists `default`, `max-length`, `missing-fields` and
  `broken-image`, and the status reaches `READY`

#### Scenario: Broken image fixture

- **WHEN** a visitor opens `/viewer/memory-box/1.1.0?fixture=broken-image` and the harness sends
  `INIT` more than once during its handshake
- **THEN** the harness shows `Vấn đề nội dung: 2`, and both affected memory scenes show text cards

#### Scenario: Fixture fails validation

- **WHEN** a harness fixture other than `missing-fields` fails full payload validation against its
  release's manifest
- **THEN** the template's test suite fails naming the fixture
