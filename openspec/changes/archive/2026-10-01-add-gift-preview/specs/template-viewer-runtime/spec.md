# Spec Delta

## MODIFIED Requirements

### Requirement: Initialization handshake

The system SHALL send `INIT` to the iframe after mount and on every iframe load. It SHALL resend
`INIT` every 250 ms until a `READY` event is received, up to 20 attempts in total. An iframe `load`
event SHALL start a new handshake, with its own count of 20 attempts. When 20 attempts pass without
`READY`, the host MUST stop resending. The Viewer harness then reports the status `INIT timeout`,
and the gift viewer switches to its static fallback (see `gift-viewer`). The gift viewer counts
only the attempts after the iframe's latest `load` event, so an artifact that is slow to load is
not treated as a timeout. Receiving `READY` MUST stop the resend timer.

#### Scenario: Template becomes ready

- **WHEN** the artifact answers an `INIT` with `READY`
- **THEN** the host stops resending `INIT` and shows the status `READY`

#### Scenario: Template never becomes ready

- **WHEN** no `READY` event arrives after 20 `INIT` attempts
- **THEN** the host stops resending and shows the status `INIT timeout`

#### Scenario: Slow artifact load in the gift viewer

- **WHEN** the gift viewer's iframe fires `load` 8 seconds after mount and the template answers
  `READY` within its next 20 attempts
- **THEN** the gift viewer does not switch to its static fallback

### Requirement: Lifecycle control

The system SHALL let a host drive the runtime with `PLAY`, `PAUSE` and `DESTROY` commands. The
Viewer harness SHALL reflect the latest valid event type other than `ISSUE` as the Viewer status,
showing `Runtime error: {code}` for an `ERROR` event. The gift viewer reacts to events as specified
in `gift-viewer`, and shows no status text. A valid `ISSUE` event MUST be recorded in the harness
event log without changing the Viewer status. `DESTROY` MUST stop the host from listening for
further template events and release any audio. When a host is unmounted, it MUST send `DESTROY`
and stop listening. A host other than the diagnostic Viewer harness, such as the gift viewer, MUST
send `PLAY` only after it has received `READY`. A conforming template SHALL go `READY` → (`PLAY`) →
`SCENE` → `COMPLETE`, MAY send `ISSUE` events after `READY`, and SHALL answer a malformed `INIT`
with `ERROR` code `INVALID_MESSAGE`. For a `PLAY` received before a valid `INIT`, a conforming
template SHALL do one of two things. It SHALL either answer with `ERROR` code `INVALID_MESSAGE`, as
the reference template does, or hold the `PLAY` until its first valid `INIT` without sending
`ERROR`, as `memory-box` does.

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

#### Scenario: Gift viewer waits for READY

- **WHEN** the person opens a gift in the gift viewer before the template has sent `READY`
- **THEN** the gift viewer sends no `PLAY` until `READY` arrives

#### Scenario: Unmounting the gift viewer

- **WHEN** the page that shows a gift viewer navigates away
- **THEN** the gift viewer sends `DESTROY`, stops listening for template events and releases its
  audio

### Requirement: Pause when the page is hidden

The system SHALL, when the host document becomes hidden (`visibilitychange` with `document.hidden`
true), send `PAUSE` to the template and pause any playing audio. The Viewer harness SHALL show the
status `PAUSE · tab ẩn`. The gift viewer SHALL do this only after the gift was opened and before
`COMPLETE`, and SHALL offer `Tiếp tục` to resume (see `gift-viewer`).

#### Scenario: Tab hidden during playback

- **WHEN** the viewer switches to another tab while the template is playing
- **THEN** the host sends `PAUSE` and pauses audio

#### Scenario: Harness status while hidden

- **WHEN** the Viewer harness page becomes hidden
- **THEN** the harness shows the status `PAUSE · tab ẩn`

### Requirement: Audio only after a user gesture

The system SHALL NOT start audio automatically. When an audio source is supplied to a host, it
SHALL be loaded with `preload="none"`. It SHALL play only inside the handler of a user action: the
Viewer harness's `Phát` action, or the gift viewer's `Mở quà` or `Tiếp tục` action. Playback
results SHALL be classified as:

- `playing`;
- `blocked`: the browser's autoplay policy rejected playback with `NotAllowedError`;
- `failed`: any other error.

For `blocked` or `failed`, the host MUST keep the template running and show a visible fallback. The
Viewer harness shows `PLAY · audio {result}`, and the gift viewer shows `Không phát được nhạc.`.
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

#### Scenario: Gift viewer audio blocked

- **WHEN** a person chooses `Mở quà` and the browser rejects audio playback
- **THEN** the template still receives `PLAY` and the gift viewer shows `Không phát được nhạc.`
