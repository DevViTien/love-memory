## MODIFIED Requirements

### Requirement: Static fallback keeps the content

The gift viewer SHALL replace the template with a host-rendered static rendering of the content in
any of these cases:

- the payload's `artifactUrl` is `null`;
- the template sends a valid `ERROR` event of either code, before or after opening;
- no `READY` arrives within 20 `INIT` attempts after the iframe's latest `load` event;
- the iframe fires no `load` event within 15 seconds of receiving its artifact URL;
- the iframe fires a second `load` event for its artifact URL, because the document navigated its
  own frame (reason `NAVIGATED`).

On switching, the gift viewer SHALL send `DESTROY` (except to a navigated frame, which gets no
message at all), remove the iframe and stop listening to it. It
SHALL keep any audio that is already playing. The switch is final for that mount.

The static rendering SHALL show every field of `fields` that has a value, in declaration order,
without labels or animation:

- `shortText` and `longText` values as text, keeping line breaks;
- `date` values as `DD/MM/YYYY`;
- `textList` values as one paragraph with one non-blank line per item;
- each image item, including the photo of an `image` field, as its image, from the `assets` URL with no referrer, followed by its caption.
  When the image has no URL or fails to load, the caption is shown instead, or `Ảnh {n}` when
  there is no caption.

`theme`, `audio`, `passcode` and `color` values SHALL NOT be rendered as text. All values MUST be rendered as text, never
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

#### Scenario: Frame navigated away

- **WHEN** the iframe fires a second `load` for the artifact URL, because the document navigated
  its own frame
- **THEN** the gift viewer sends that window nothing more, not even `DESTROY`, and shows the
  static rendering with the reason `NAVIGATED`

#### Scenario: Html template fallback

- **WHEN** a `love-days`-style gift with a `textList` value `["Một", "Hai"]`, an `image` photo, a
  `passcode` and a `color` falls back to the static rendering
- **THEN** the lines `Một` and `Hai` and the photo are shown, and the passcode and color are not

### Requirement: Lifecycle notifications

The gift viewer SHALL report its lifecycle to its host page through one notification channel:

- `opened`, when the person chooses `Mở quà` and the content is available;
- `scene`, with the `sceneId`, for each valid `SCENE` event;
- `completed`, for the first `COMPLETE` of a play-through;
- `fallback`, with the reason (`ERROR`, `INIT_TIMEOUT`, `LOAD_TIMEOUT`, `NAVIGATED` or
  `NO_ARTIFACT`), when it switches to the static rendering.

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

#### Scenario: Navigation notification

- **WHEN** the template's frame navigates to another document
- **THEN** the host page is notified `fallback` with reason `NAVIGATED`, once
