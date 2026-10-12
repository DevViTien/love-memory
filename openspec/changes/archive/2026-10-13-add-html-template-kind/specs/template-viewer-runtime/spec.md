## ADDED Requirements

### Requirement: HTML template bootstrap

The system SHALL load the bootstrap `love-gift.js` as the first script of every `html` artifact.
The bootstrap holds the field mapping of its version (`id`, `type` and `path` of every field but
`audio`), reads the defaults from `#gift-config`, and speaks the message protocol of this
capability:

- It accepts messages only from `window.parent`. A valid `INIT` (protocol version `1`, an object
  `payload`, a `context` with `locale` and `prefersReducedMotion`, and `assets` mapping ids to
  strings) configures the gift once the document is parsed and is answered with `READY`; a later
  `INIT` is answered with `READY` again without configuring anew. An `INIT` with the type `INIT`
  but another shape is answered with `ERROR` code `INVALID_MESSAGE`; `DESTROY` needs no answer.
- Configuring merges the gift's values into a copy of the defaults at each field's `path`:
  `shortText`, `longText`, `date`, `theme`, `passcode` and `color` as trimmed strings; `textList`
  as its non-blank lines; `image` as the URL of its asset in `INIT` `assets`; `imageList` as the
  URLs of its available assets; `captionedImageList` as `{ src, caption }` items of its available
  assets. An absent or empty value, or a photo without an asset URL, keeps the default. It also
  sets `data-reduced-motion="true"` on `<html>` when the `INIT` context asks for reduced motion,
  and starts loading every photo of the merged configuration at once, keeping the images alive,
  so that the template's later use after `PLAY` comes from the image cache even when the
  short-lived signed URLs have expired.
- The frozen `window.LoveGift` offers `config()` (the merged configuration), `reducedMotion()`
  (the host's reduced-motion request), `complete()` (posts `COMPLETE`) and `scene(id)` (posts
  `SCENE` for an id of 1 to 80 characters).
- The template's scripts run in document order only on the first `PLAY` after `READY`, that is
  when the recipient chooses `Mở quà`; a `PLAY` that arrives before `INIT` is held until then.
  Later `PAUSE` and `PLAY` are dispatched to the template as the window events `lovegift:pause`
  and `lovegift:play`; the last one received while the scripts are still loading is dispatched
  once they have started.
- A script that fails to load or throws while starting, including a `DOMContentLoaded` or `load`
  listener it added, is answered with `ERROR` code `RUNTIME_ERROR`. Listeners for
  `DOMContentLoaded` or `load` added after those events, and a newly set `window.onload`, are
  called once on the next task.
- In a frame, the bootstrap never starts by itself: without `INIT` the host's handshake times out
  (`INIT_TIMEOUT`) and shows the static rendering. Only opened directly (`window.parent` is the
  window itself) does it start at once with the defaults, posting nothing; reduced motion then
  follows the system preference.

The bootstrap MUST NOT use `fetch`, `XMLHttpRequest`, WebSockets or storage APIs.

#### Scenario: Gift values reach the template

- **WHEN** a `love-days` gift with `person1-name` `Minh Thư` and `start-date` `2023-08-14` is
  opened with `Mở quà`
- **THEN** `LoveGift.config()` returns `person1.name` `Minh Thư` and `startDate` `2023-08-14`
  merged into the defaults, and the template shows them

#### Scenario: Nothing runs behind the envelope

- **WHEN** the preview loads a `love-days` gift and the template answered `READY`
- **THEN** none of the template's scripts has run until the person chooses `Mở quà`

#### Scenario: Photo without an asset URL

- **WHEN** the `photo` value's asset id has no entry in `INIT` `assets`
- **THEN** `LoveGift.config().photo` keeps the default sample photo

#### Scenario: Photos requested at INIT

- **WHEN** the gift is configured with a signed URL for its `photo` and the recipient opens it
  after that URL expired
- **THEN** the photo was already requested at `INIT`, and the template shows it from the image
  cache

#### Scenario: Pause while the scripts load

- **WHEN** the host sends `PAUSE` while the template's scripts are still loading after `PLAY`
- **THEN** the template receives `lovegift:pause` once its scripts have started

#### Scenario: Reduced motion

- **WHEN** the `INIT` context has `prefersReducedMotion` `true`
- **THEN** `LoveGift.reducedMotion()` is `true` and `<html>` has `data-reduced-motion="true"`

#### Scenario: Template script error

- **WHEN** a template script throws after `PLAY`
- **THEN** the bootstrap posts `ERROR` with code `RUNTIME_ERROR`

#### Scenario: Framed without INIT

- **WHEN** the artifact is framed and no `INIT` arrives
- **THEN** the template never starts and posts nothing

#### Scenario: Author preview

- **WHEN** an author opens an imported artifact's `index.html` directly in a browser
- **THEN** the template starts with its defaults and posts no message

## MODIFIED Requirements

### Requirement: Initialization handshake

The system SHALL send `INIT` to the iframe after mount and on every iframe load. It SHALL resend
`INIT` every 250 ms until a `READY` event is received, up to 20 attempts in total. In the Viewer harness, an iframe `load` event SHALL start a new handshake, with its own count of
20 attempts. The gift viewer handshakes only after the first `load` of the artifact URL: a later
`load` with the same URL means that the document navigated its own frame, so the gift viewer
MUST NOT post anything to that window again, not even `DESTROY`, and switches to its static
fallback with the reason `NAVIGATED` (`gift-viewer`). When 20 attempts pass without
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

#### Scenario: Frame navigated away

- **WHEN** the template's frame loads another document after the artifact, for example through
  `location.replace("//evil.example")`
- **THEN** the gift viewer posts no `INIT` or other message to that window, ignores any `READY`
  from it, and shows the static rendering

### Requirement: Asset URL allowlist injection

The system SHALL give a template access to media only through the `INIT` `assets` map of asset id
to URL supplied by the host; image fields in the payload carry asset ids, never URLs (see
`template-manifest-contract`). The template CSP limits image sources to `data:`, the private blob
origin, the configured asset origin and the artifact's own files. A conforming
template SHALL render an image only when its asset id is present in `assets`, ignoring ids without
an injected URL. When the host supplies no asset URLs, `assets` MUST be sent as `{}`.

#### Scenario: Asset id without injected URL

- **WHEN** the payload's image list references an asset id that is not a key of `assets`
- **THEN** the reference template does not render that image

#### Scenario: No asset URLs supplied

- **WHEN** the Viewer is rendered without asset URLs
- **THEN** `INIT` carries `assets` `{}`

#### Scenario: Html template photo

- **WHEN** an `html` template's `image` field references an asset id that is a key of `assets`
- **THEN** the bootstrap gives the template that signed URL, and never the asset id itself
