## MODIFIED Requirements

### Requirement: Envelope and opening gesture

The gift viewer SHALL start with an envelope. The envelope is a host-rendered cover with the
heading `Bạn có một món quà` and a native button `Mở quà`, and it shows no gift content. With a
ready source, the gift viewer SHALL already load the template iframe and complete the
initialization handshake behind the envelope. The iframe is hidden from assistive technology and
does not receive focus.

The gift viewer SHALL create the iframe element on the client only together with its artifact URL,
with its `load` listener attached before the element is inserted. That way a `load` event, even of
a cached artifact, is never missed, and no load of an initial `about:blank` document is ever
observed. A `load` event while the iframe's `src` attribute is not that artifact URL SHALL be
ignored: it neither ends the 15-second load wait nor starts the handshake.

Choosing `Mở quà` SHALL do three things:

- remove the envelope;
- start audio inside that gesture handler, as described in "Audio playback and mute";
- send `PLAY` to the template as soon as the template has answered `READY`.

A `PLAY` MUST NOT be sent before `READY`. If `READY` has not arrived yet, or the deferred load is
still running, the gift viewer SHALL show `Đang mở quà…` and send `PLAY` when `READY` arrives.
After opening, keyboard focus SHALL move to the template frame, or to the static content when the
fallback is shown. When the static rendering replaces the template after opening, focus SHALL move
to the static content. Focus MUST NOT be left on the document body when the control that had it
disappears: while `Đang mở quà…` is shown, focus SHALL be on that status message; when `Tiếp tục` is
shown, focus SHALL move to it; and when the load fails, focus SHALL move to `Thử lại`.

#### Scenario: Open a ready template

- **WHEN** the template has answered `READY` and the person chooses `Mở quà`
- **THEN** the envelope disappears and the host sends `PLAY` once

#### Scenario: Tap before the template is ready

- **WHEN** the person chooses `Mở quà` before `READY`
- **THEN** `Đang mở quà…` is shown, no `PLAY` is sent, and `PLAY` is sent right after `READY` arrives

#### Scenario: Initial blank document load

- **WHEN** the gift viewer creates the template iframe
- **THEN** the element is created with the artifact URL as its `src`, so no `load` of an initial
  `about:blank` document is observed, and only the artifact's `load` sends `INIT` and ends the
  15-second load wait

#### Scenario: Keyboard focus while opening

- **WHEN** a keyboard user presses Enter on `Mở quà` before the template is ready
- **THEN** focus moves to `Đang mở quà…`, and then to the template frame once the gift plays

#### Scenario: Cached artifact on reload

- **WHEN** the page that holds the gift viewer is reloaded and the artifact is served from the
  browser cache
- **THEN** the template still answers `READY`, and choosing `Mở quà` plays the gift without
  falling back to the static rendering

#### Scenario: Nothing plays without the gesture

- **WHEN** the gift viewer has loaded and the person has not chosen `Mở quà`
- **THEN** no `PLAY` has been sent and no audio playback has been attempted

### Requirement: Pause and resume with page visibility

When the page becomes hidden after the gift was opened and before `COMPLETE`, the gift viewer SHALL
send `PAUSE` to the template and pause the audio. When the page is visible again, it SHALL show a
`Tiếp tục` button, move keyboard focus to it, and MUST NOT resume by itself. Choosing `Tiếp tục`
SHALL send `PLAY` and resume the audio inside that gesture. A page hidden before opening SHALL only
pause the audio. A page hidden after `COMPLETE` SHALL pause the audio and, when the page is visible
again, resume the audio that the opening gesture started, because the finale has no `Tiếp tục`
control; when the browser refuses that playback, the notice `Không phát được nhạc.` is shown.

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

#### Scenario: Hidden after the gift completed

- **WHEN** the gift has sent `COMPLETE` while its music plays, and the person switches to another app
  and comes back
- **THEN** the audio was paused while the page was hidden and plays again when the page is visible,
  without `PAUSE` or `PLAY` being sent to the template

#### Scenario: Hidden before opening

- **WHEN** the page is hidden while the envelope is still shown
- **THEN** no `PAUSE` is sent and the envelope is still shown on return
