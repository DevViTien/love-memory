# Memory Box v1 storyboard and motion specification

- Status: engineering baseline, ready for Product Owner/design review
- Template ID: `memory-box`
- Spike artifact: `memory-box-spike@0.1.0`
- Target duration: 45–70 seconds, receiver-controlled

## Narrative

The receiver discovers a small closed box, opens it with one deliberate gesture, then sees selected
memories before reading a final message. Motion supports anticipation and warmth; it must not block
the story or require precise gestures.

## Input contract

| Field             | Type           | Requirement                                   |
| ----------------- | -------------- | --------------------------------------------- |
| `receiverName`    | short text     | Required, 1–40 characters                     |
| `openingMessage`  | long text      | Required, maximum 400 characters              |
| `anniversaryDate` | date           | Optional                                      |
| `photos`          | image list     | Required, 3–12, normalized to 4:3 derivatives |
| `theme`           | theme          | `rose-night` or `warm-paper`                  |
| `audio`           | licensed audio | Optional; starts only after user gesture      |

## Scene sequence

| Scene        | Trigger and duration                   | Visual/motion                                                     | Runtime events and fallback                               |
| ------------ | -------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Cover        | Viewer ready; waits indefinitely       | Box centered, subtle 2 px breathing over 2.4 s                    | No audio/autoplay; CTA remains readable                   |
| Opening      | Receiver taps; 0.8 s                   | Lid lifts 18 px, box scales 1 → 1.04, warm radial glow            | `SCENE opening`; reduced motion uses instant state change |
| Memory cards | Continue/timer; 4–8 s per image        | One image at a time, opacity and 8 px translate; user can advance | `SCENE memory-n`; broken image becomes text card          |
| Letter       | After final image; receiver-controlled | Message reveals by paragraph, not character typing                | `SCENE letter`; plain text always selectable/readable     |
| Finale       | Continue; 1.2 s                        | Small hearts/particles within budget, then stable closing card    | `COMPLETE`; reduced motion removes particles              |

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

Use Vietnamese diacritics, emoji, maximum-length text, portrait/landscape photos and one broken image.
Capture normal, reduced-motion, no-audio and play-rejected states. Production implementation begins
only after Product Owner/design accepts the narrative and input contract above.
