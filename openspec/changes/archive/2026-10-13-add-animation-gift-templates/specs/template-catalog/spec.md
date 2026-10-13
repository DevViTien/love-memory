## MODIFIED Requirements

### Requirement: Template summary is derived from the stored manifest

The system SHALL build each catalog entry from the stored manifest of the selected version, after
re-validating it against the template manifest schema. A summary MUST expose only `id`, `version`,
`name`, `description`, `estimatedDurationSec`, `moods`, `available`, `thumbnailUrl` for an `html`
version whose artifact holds the file `assets/thumbnail.jpg` (the same-origin URL
`/template-artifacts/{id}/{version}/{artifactContentHash}/assets/thumbnail.jpg`, built from the
stored file names only, never a storage key), and, when the manifest
declares an image field (`imageList`, `captionedImageList` or `image`), an `imageRequirement` whose
`minItems` and `maxItems` add up the ranges of every image field: a list field's `minItems` and
`maxItems`, and for an `image` field `1` and `1` when it is required, `0` and `1` otherwise. `available` SHALL be `true` only when a
template artifact is registered for that exact `id` and `version` (`template-artifact-delivery`),
either as an `sdk` release or as an imported `html` version, so
a gift created from it can be previewed with the template and published; otherwise it is `false`.
Stored manifests that fail validation MUST NOT be rendered as catalog entries. Such a version
SHALL be left out of the catalog and of the template detail, and reported to the operational log by
its `<templateId>@<version>` only, without failing the other entries (for example an `html` version
read by a build that predates the kind).

#### Scenario: Template with an image field

- **WHEN** the current version of `memory-box` declares an `imageList` field with `minItems` 3 and
  `maxItems` 8
- **THEN** its summary includes `imageRequirement` `{ minItems: 3, maxItems: 8 }`

#### Scenario: Template with a captioned image field

- **WHEN** the current version declares a `captionedImageList` field with `minItems` 3 and
  `maxItems` 8 and no `imageList` field
- **THEN** its summary includes `imageRequirement` `{ minItems: 3, maxItems: 8 }`

#### Scenario: Template without an image field

- **WHEN** the current version declares no `imageList` or `captionedImageList` field
- **THEN** its summary has no `imageRequirement`

#### Scenario: Version with a registered artifact

- **WHEN** the current version is `memory-box` `1.1.0`, whose artifact is registered
- **THEN** its summary has `available` `true`

#### Scenario: Version without a registered artifact

- **WHEN** the current version is `future-template` `1.0.0`, published but with no registered
  artifact
- **THEN** its summary has `available` `false`, and it is still listed in the catalog

#### Scenario: Invalid stored manifest

- **WHEN** the stored manifest of a selected version fails schema validation
- **THEN** that entry is left out, the other entries are listed, and the log names only its
  `<templateId>@<version>`

#### Scenario: Template with single photo fields

- **WHEN** the current version is `love-days` `1.0.0`, with two optional `image` fields and one
  required `image` field
- **THEN** its summary includes `imageRequirement` `{ minItems: 1, maxItems: 3 }`, and its card
  shows `1–3 ảnh`

#### Scenario: Imported html version

- **WHEN** the current version is `love-days` `1.0.0`, imported by `db:seed`
- **THEN** its summary has `available` `true`, and `/studio/new?template=love-days` offers to
  create a draft

#### Scenario: Html version with a thumbnail

- **WHEN** the current version is `memories` `1.0.0`, imported with `assets/thumbnail.jpg` under
  the artifact hash `{hash}`
- **THEN** its summary has `thumbnailUrl`
  `/template-artifacts/memories/1.0.0/{hash}/assets/thumbnail.jpg`

#### Scenario: No thumbnail file or sdk version

- **WHEN** the current version is an `html` version without `assets/thumbnail.jpg`, or an `sdk`
  version such as `memory-box` `1.1.0`
- **THEN** its summary has no `thumbnailUrl`

### Requirement: Template detail page

The system SHALL serve a detail page at `/templates/{templateId}` for a template that satisfies the
same published-current-version rule as the catalog list. The page MUST show the template name,
description, localized mood label, duration label and photo requirement, and link back to
`/templates`. When the summary is `available`, the page SHALL offer a call to action linking to
`/studio/new?template={templateId}`. When it is not, the page MUST NOT offer that link and SHALL show
`Sắp ra mắt` with the explanation `Mẫu quà này đang được hoàn thiện, bạn chưa thể tạo quà từ mẫu này.`
The page title and description metadata SHALL be the template's `name` and `description`.

#### Scenario: Published template detail

- **WHEN** a visitor opens `/templates/memory-box` and `memory-box` has a published current version
- **THEN** the page shows that version's metadata and a link to `/studio/new?template=memory-box`

#### Scenario: Template that is not yet available

- **WHEN** a visitor opens `/templates/future-template` and its published current version has no
  registered artifact
- **THEN** the page shows its metadata, `Sắp ra mắt` and the explanation, and no link to
  `/studio/new?template=future-template`

#### Scenario: Unknown or unpublished template

- **WHEN** a visitor opens `/templates/{templateId}` for a template that does not exist, is not
  `published`, or whose current version is not `published`
- **THEN** the application not-found page is rendered instead of template details
- **AND** the page metadata title is `Không tìm thấy template`

### Requirement: Card presentation rules

The system SHALL present every catalog entry as a card whose labels are derived deterministically
from the summary: the duration label is `Khoảng {estimatedDurationSec} giây`; the mood label joins
the Vietnamese label of each mood with `·` (`warm` → `Ấm áp`, `playful` → `Bất ngờ`,
`nostalgic` → `Hoài niệm`, `dreamy` → `Mơ màng`, `romantic` → `Lãng mạn`) and shows unknown mood
identifiers verbatim; the photo requirement is `{minItems}–{maxItems} ảnh` when an
`imageRequirement` exists, `{minItems} ảnh` when its `minItems` and `maxItems` are equal, and
`Không bắt buộc` otherwise. A card whose summary is not `available`
SHALL also show the badge `Sắp ra mắt`. Each card MUST link to `/templates/{id}`. When the summary is
`available` and has a `thumbnailUrl`, the card and the template detail page SHALL show that picture
on the template's gradient instead of the icon, with the alternative text
`Hình minh họa mẫu quà {name}`, loaded lazily from the same origin, so the catalog's
static-compatible CSP (`img-src 'self'`) allows it. A summary without a `thumbnailUrl`, or not
`available`, SHALL keep the gradient and icon of its template. Templates without a
dedicated visual SHALL use a neutral fallback visual (icon `💝`) rather than failing.

#### Scenario: Known template card

- **WHEN** a card is built for `memory-box` with `estimatedDurationSec` 75, moods `warm` and
  `playful`, and an image requirement of 3 to 8
- **THEN** it shows `Khoảng 75 giây`, `Ấm áp · Bất ngờ` and `3–8 ảnh` with icon `🎁`

#### Scenario: Newly introduced template

- **WHEN** a card is built for an unmapped template id with mood `new-mood` and no image requirement
- **THEN** it shows the mood label `new-mood`, the photo requirement `Không bắt buộc` and icon `💝`

#### Scenario: Card of a template that is not yet available

- **WHEN** a card is built for `future-template` whose summary has `available` `false`
- **THEN** it shows the badge `Sắp ra mắt` and still links to `/templates/future-template`

#### Scenario: Card of an html template with a thumbnail

- **WHEN** a card is built for `memories`, `available`, with a `thumbnailUrl`
- **THEN** it shows that picture with the alternative text
  `Hình minh họa mẫu quà Kỷ niệm của chúng mình` instead of its icon `📔`

#### Scenario: Card of a one-photo template

- **WHEN** a card is built for `envelope-letter`, whose summary has `imageRequirement`
  `{ minItems: 1, maxItems: 1 }`
- **THEN** it shows the photo requirement `1 ảnh`

#### Scenario: Thumbnail of a template that is not available

- **WHEN** a card is built for a summary with a `thumbnailUrl` and `available` `false`
- **THEN** it shows its gradient and icon, and the badge `Sắp ra mắt`

### Requirement: Seeded launch templates

The system SHALL provide a seed command (`db:seed`) that idempotently upserts the published
`sdk` template `memory-box` (`Hộp ký ức`) at current version `1.1.0`, with `sortOrder` `0`.

The seed SHALL no longer create the catalog placeholders of the `sdk` era, `our-timeline`
(`Dòng thời gian hai đứa`) and `midnight-wish` (`Bầu trời lời nhắn`), both at version `1.0.0`
without an artifact: the `html` templates replace them. Where an earlier seed stored them, it
SHALL set their `sdk` versions `our-timeline@1.0.0` and `midnight-wish@1.0.0` to status
`retired`, keeping their stored manifests, and their `templates` documents too while their
`currentVersion` is that placeholder version, so they leave the catalog and new drafts while
drafts that pin them stay editable. It MUST NOT retire an `html` version, or a template whose
current version an operator re-published, under these ids. It SHALL create nothing for them on a
database that never stored them, and a re-run SHALL change nothing more.

The `memory-box` `1.1.0` manifest and preview fixture MUST be the ones of the committed release
`templates/memory-box/releases/1.1.0/`. The seed SHALL also keep the earlier release `memory-box` `1.0.0`, with its
original manifest and preview fixture, as a version with status `retired`. After it, the seed
SHALL import every bundled `html` template folder under `templates-html/`, published
(`template-artifact-delivery` "HTML template import command"), in the catalog order listed by
`templates-html/catalog-order.json` (a folder it does not list comes after, in folder name order),
each with the next `sortOrder` from `3` (after the positions `0` to `2` of the `sdk` era) when it is
stored for the first time. Today these are `love-days`
(`Trái tim yêu thương`), then `envelope-letter`, `galaxy-text`, `heart-photo`, `matrix-text` and
`memories` ("Bundled animation templates"), each at version `1.0.0`.

Seeding MUST:

- set each template's `currentVersion` and status from its current version's manifest;
- store every version under the identity `{templateId}@{version}` together with its manifest and
  preview fixture;
- abort if a template has no preview fixture, or its preview fixture fails payload validation
  against the manifest;
- abort, without changing that version, when a version is already stored with a manifest whose
  content differs, ignoring key order, because a template release is immutable;
- leave the status of a version that an admin retired or killed (`template-version-controls`)
  unchanged, so a re-run never brings it back into the catalog or new drafts.

#### Scenario: Seed on an empty database

- **WHEN** `db:seed` runs against an empty database
- **THEN** the catalog lists `memory-box` at version `1.1.0`, then `love-days`,
  `envelope-letter`, `galaxy-text`, `heart-photo`, `matrix-text` and `memories` each at version
  `1.0.0`, in that order
- **AND** `memory-box` `1.0.0` is stored with status `retired`, and neither `our-timeline` nor
  `midnight-wish` is stored

#### Scenario: Upgrading a database seeded with 1.0.0

- **WHEN** `db:seed` runs against a database where `memory-box` `1.0.0` is the published current
  version and drafts pin it
- **THEN** `memory-box` `1.0.0` keeps its stored manifest and becomes `retired`, `currentVersion`
  becomes `1.1.0`, and those drafts stay editable against the `1.0.0` manifest
- **AND** new drafts can be created only on `memory-box` `1.1.0`

#### Scenario: Re-running the seed

- **WHEN** `db:seed` runs again against an already seeded database
- **THEN** the existing records are updated in place and no duplicate templates or versions are
  created

#### Scenario: Invalid preview fixture

- **WHEN** a seed manifest's preview fixture does not satisfy that manifest's payload rules
- **THEN** seeding fails before writing that template

#### Scenario: Stored release differs from the seed

- **WHEN** `memory-box@1.1.0` is already stored with a manifest whose content differs from the
  committed release manifest
- **THEN** seeding fails naming `memory-box@1.1.0` and leaves the stored version unchanged

#### Scenario: Re-seeding keeps an admin retire

- **WHEN** an admin retired `memory-box` `1.1.0` and `db:seed` runs again
- **THEN** `memory-box` `1.1.0` stays `retired`, and every other seeded version gets its seeded
  status

#### Scenario: Bundled html template seeded

- **WHEN** `db:seed` runs twice against an empty database with object storage configured
- **THEN** `love-days@1.0.0` is stored once with `kind` `html`, its files are in object storage,
  and the second run reports it `unchanged`

#### Scenario: Placeholders retired on a database seeded before

- **WHEN** `db:seed` runs against a database where `our-timeline` and `midnight-wish` are
  published at `1.0.0` and a draft pins `midnight-wish@1.0.0`
- **THEN** both templates and both versions have status `retired` with their manifests unchanged,
  the catalog no longer lists them, `/templates/midnight-wish` is not found, a new draft on
  `midnight-wish@1.0.0` is refused, and the pinned draft stays editable

#### Scenario: Placeholder id re-published as an html template

- **WHEN** an operator imported and published an `html` `our-timeline@2.0.0` (or an `html`
  `our-timeline@1.0.0` on a database that never stored the placeholder) and `db:seed` runs
- **THEN** that version and the `our-timeline` template stay `published`

#### Scenario: New bundled templates on a database seeded before

- **WHEN** `db:seed` runs against a database that holds `love-days` with `sortOrder` `3` and none
  of the five other bundled templates
- **THEN** `love-days` keeps `sortOrder` `3`, and `envelope-letter`, `galaxy-text`, `heart-photo`,
  `matrix-text` and `memories` are stored with `sortOrder` `4` to `8`, after it

## ADDED Requirements

### Requirement: Bundled animation templates

The system SHALL bundle, besides `love-days`, the five templates of the `animation-gift`
collection as `html` templates at version `1.0.0`. Each SHALL have a manifest whose fields map to
its defaults (`template-manifest-contract`), Vietnamese steps, labels and help texts, bundled fonts
with their licence, generated sample photos that show no person, and `assets/thumbnail.jpg`:

- `envelope-letter` (`Thư tay`): `card-title` (`textList`, 1–3 lines), `photo` (`image`,
  required), `letter` (`textList`, 1–12 paragraphs, required); one photo.
- `galaxy-text` (`Thông điệp giữa ngân hà`): `gate-title` and `gate-hint` (`shortText`),
  `hero-texts` (`textList`, 1–4, required), `texts` (`textList`, 3–16, required), `photos`
  (`imageList`, 0–6), `text-color` and `glow-color` (`color`); photos `0–6`.
- `heart-photo` (`Trái tim kỉ niệm`): `messages` (`textList`, 1–4 items of at most 24
  characters, required), `photos`
  (`imageList`, 1–6, required), `caption` (`shortText`), `heart-color` and `glow-color`
  (`color`); photos `1–6`.
- `matrix-text` (`Lời nhắn ma trận`): `messages` (`textList`, 1–8, required), `heart-text` and
  `rain-chars` (`shortText`), `text-color` and `heart-color` (`color`); no photo.
- `memories` (`Kỷ niệm của chúng mình`): `start-date` (`date`, required), `her-name` and
  `him-name` (`shortText`, required), `avatar-her`, `avatar-him` and `popup-photo` (`image`),
  `passcode` (`passcode`, 4 digits), `gallery` (`captionedImageList`, 1–12, required),
  `letter-paragraphs` (`textList`, 1–10, required), and the `shortText` fields `intro-title`,
  `pass-hint`, `couple-title`, `popup-caption`, `letter-card-label`, `letter-title`,
  `letter-closing` and `letter-signature`; photos `1–15`.

Each template SHALL render the gift's values only as text (DOM text or canvas drawing, never as
markup), SHALL play no audio of its own (the gift page plays the licensed track), SHALL honour the
host's reduced-motion request (`LoveGift.reducedMotion()`) as well as the system setting, and
SHALL report its moments with `LoveGift.scene` and its end with `LoveGift.complete`. On
`lovegift:pause` it SHALL stop its drawing loop and its timers (auto-open, reveal and message
sequences, counters), so that nothing advances or completes while the gift page is hidden, and on
`lovegift:play` it SHALL resume them where they stopped; at most one drawing loop SHALL ever run.
A font that fails or is slow to load SHALL never keep a template from starting. In the
messages of `galaxy-text`, `heart-photo` and `matrix-text`, a `|` SHALL be a line break. The
`memories` passcode is a playful lock: its default is empty, and an empty passcode SHALL open the
gift without asking for one. The `memories` album photos SHALL be keyboard buttons: `Enter` or
`Space` opens one, `Escape` closes it and returns the focus to it. The required photos of each template SHALL fit the Free plan (at most
3 photos).

#### Scenario: Catalog lists the bundled templates

- **WHEN** a visitor opens `/templates` after `db:seed`
- **THEN** the six `html` templates are listed, each available with its thumbnail, and `memories`
  shows `1–15 ảnh`

#### Scenario: Gift values are text

- **WHEN** a `memories` gift has the album caption `Biển <b>Nha Trang</b>`
- **THEN** the album shows those characters as text, and the document gains no `b` element

#### Scenario: Gift without a passcode

- **WHEN** a `memories` gift leaves `passcode` empty
- **THEN** the recipient goes from the opening heart to the menu without a lock screen

#### Scenario: Gift with a passcode

- **WHEN** a `memories` gift has the passcode `1402` and the recipient types `1402`
- **THEN** the lock screen opens the menu; another code shakes the inputs and asks again

#### Scenario: Album by keyboard

- **WHEN** the recipient focuses the first `memories` album photo and presses `Enter`, then `Escape`
- **THEN** the photo opens with its caption, then closes with the focus back on the photo

#### Scenario: Hidden gift page

- **WHEN** the gift page sends `PAUSE` before `envelope-letter` opens by itself, or while
  `matrix-text` shows its messages
- **THEN** the envelope stays closed and the messages do not advance or complete until `PLAY`,
  and then continue where they stopped

#### Scenario: Font that fails to load

- **WHEN** the font of `heart-photo` fails to load
- **THEN** the template still starts with its fallback font

#### Scenario: Line break in a message

- **WHEN** a `heart-photo` gift has the message `Happy|Anniversary`
- **THEN** the heart shows `Happy` and `Anniversary` on two lines
