## MODIFIED Requirements

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
  listener it added, and a promise rejection left unhandled while the scripts start (including by
  such a late listener or a newly set `window.onload`, which the browser reports a task later), is
  answered
  with `ERROR` code `RUNTIME_ERROR`, and nothing else about the error leaves the frame. The
  scripts load as CORS scripts (`crossorigin="anonymous"`, answered by the artifact route's
  `Access-Control-Allow-Origin: *`), so that the browser reports their errors and rejections
  inside the opaque-origin sandbox. Listeners for
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

#### Scenario: Unhandled rejection while starting

- **WHEN** a template script leaves a rejected promise unhandled while the scripts start after
  `PLAY`
- **THEN** the bootstrap posts `ERROR` with code `RUNTIME_ERROR`

#### Scenario: Framed without INIT

- **WHEN** the artifact is framed and no `INIT` arrives
- **THEN** the template never starts and posts nothing

#### Scenario: Author preview

- **WHEN** an author opens an imported artifact's `index.html` directly in a browser
- **THEN** the template starts with its defaults and posts no message
