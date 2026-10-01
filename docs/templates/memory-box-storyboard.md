# Memory Box v1 storyboard and motion specification

- Status: implemented as `memory-box@1.1.0` (`templates/memory-box`, committed release
  `releases/1.1.0/`); Product Owner and design visual review of the Viewer harness captures pending
- Template ID: `memory-box`
- Release: `memory-box@1.1.0` replaces `memory-box@1.0.0`, which is retired and never edited
- Spike artifact: `memory-box-spike@0.1.0`
- Target duration: 45–70 seconds, receiver-controlled

## Narrative

The receiver discovers a small closed box, opens it with one deliberate gesture, then sees selected
memories before reading a final message. Motion supports anticipation and warmth; it must not block
the story or require precise gestures.

## Input contract

The manifest groups the fields into Studio steps in this order. Field ids are the manifest ids.

| Step (`id`, label)        | Field id           | Type                 | Requirement                                               |
| ------------------------- | ------------------ | -------------------- | --------------------------------------------------------- |
| `recipient`, Người nhận   | `receiver-name`    | `shortText`          | Required, 1–40 characters                                 |
| `recipient`, Người nhận   | `anniversary-date` | `date`               | Optional                                                  |
| `opening`, Lời mở hộp     | `opening-message`  | `shortText`          | Required, 1–120 characters                                |
| `memories`, Kỷ niệm       | `memories`         | `captionedImageList` | Required, 3–8 photos at 4:5, optional caption ≤ 140 each  |
| `letter`, Lá thư          | `final-letter`     | `longText`           | Required, 1–1200 characters                               |
| `style`, Giao diện & nhạc | `theme`            | `theme`              | `rose-night` or `warm-paper`; optional, defaults to first |
| `style`, Giao diện & nhạc | `audio`            | `audio`              | Optional licensed catalog track; starts after a gesture   |

`audio` stays optional so an empty licensed audio catalog never blocks a gift.

## Scene sequence

| Scene        | Trigger and duration                   | Visual/motion                                                                            | Runtime events and fallback                                            |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cover        | Viewer ready; waits indefinitely       | Box centered, subtle 2 px breathing over 2.4 s                                           | No audio/autoplay; CTA remains readable                                |
| Opening      | Receiver taps; 0.8 s                   | Lid lifts 18 px, box scales 1 → 1.04, warm radial glow                                   | `SCENE opening`; reduced motion uses instant state change              |
| Memory cards | Continue/timer; 4–8 s per image        | One image at a time with its caption below; opacity and 8 px translate; user can advance | `SCENE memory-n`; broken image becomes a text card showing its caption |
| Letter       | After final image; receiver-controlled | Message reveals by paragraph, not character typing                                       | `SCENE letter`; plain text always selectable/readable                  |
| Finale       | Continue; 1.2 s                        | Small hearts/particles within budget, then stable closing card                           | `COMPLETE`; reduced motion removes particles                           |

## Motion tokens

- Entrance easing: cubic-bezier(0.2, 0.8, 0.2, 1).
- Exit easing: ease-in, maximum 240 ms.
- No essential information appears only during animation.
- No infinite animation except low-amplitude cover breathing; pause it in background tabs.
- Maximum 24 DOM particles; no WebGL required for v1.
- `prefers-reduced-motion` replaces transforms/particles with opacity or immediate state.

## Audio behavior

1. Audio never starts before the receiver’s opening gesture.
2. `play()` rejection keeps the story running and exposes a visible Play control.
3. Pause/mute/replay remain reachable with at least a 44×44 CSS-pixel target.
4. Leaving/destroying the Viewer pauses and releases the source.
5. The static fallback contains the complete text even if audio cannot decode.

## Performance and accessibility gates

- Initial template JS gzip ≤ 60 KiB for production v1.
- Cover usable before downloading the complete photo sequence.
- Images use responsive derivatives; no original photo is rendered.
- Heading/order remain meaningful with CSS and animation disabled.
- Contrast meets WCAG AA for body copy and controls.
- Keyboard activation, focus visibility and screen-reader labels are required.

## Acceptance fixture

Use Vietnamese diacritics, emoji, maximum-length text and captions, photos with and without captions,
portrait/landscape photos and one broken image.
Capture normal, reduced-motion, no-audio and play-rejected states. Production implementation begins
only after Product Owner/design accepts the narrative and input contract above.
