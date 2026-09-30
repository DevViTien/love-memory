# Template Catalog

## Purpose

The template catalog lets visitors browse the published LoveMemory templates on the home page and
at `/templates`, and open a detail page for one template before starting a gift in the Studio. It
reads the persisted template registry (`templates` and `templateVersions` collections) and exposes
only the current published version of each template. Manifest structure is defined by
`template-manifest-contract`; executing a template belongs to `template-viewer-runtime`.

## Requirements

### Requirement: Catalog lists only published current versions

The system SHALL list a template in the catalog only when its `templates` record has status
`published` and the `templateVersions` record matching that template's `currentVersion` also has
status `published`. Each listed template MUST be represented exactly once, by its `currentVersion`;
older versions and versions with status `draft` or `retired` MUST NOT be listed. Listed templates
SHALL be ordered by `sortOrder` ascending, then by template id ascending.

#### Scenario: Current published version is listed

- **WHEN** a template record is `published` with `currentVersion` `2.0.0` and published versions
  `0.9.0` and `2.0.0` exist
- **THEN** the catalog lists that template once, with version `2.0.0`

#### Scenario: Current version is not published

- **WHEN** a template record is `published` but its `currentVersion` has no `templateVersions`
  record with status `published`
- **THEN** the template is omitted from the catalog

#### Scenario: Unpublished template record

- **WHEN** a template record has status `draft` or `retired`
- **THEN** the template is omitted from the catalog regardless of its versions

#### Scenario: Empty registry

- **WHEN** no template record has status `published`
- **THEN** the catalog returns an empty list

### Requirement: Template summary is derived from the stored manifest

The system SHALL build each catalog entry from the stored manifest of the selected version, after
re-validating it against the template manifest schema. A summary MUST expose only `id`, `version`,
`name`, `description`, `estimatedDurationSec`, `moods`, and, when the manifest declares an
`imageList` field, an `imageRequirement` with that first `imageList` field's `minItems` and
`maxItems`. Stored manifests that fail validation MUST NOT be rendered as catalog entries.

#### Scenario: Template with an image field

- **WHEN** the current version of `memory-box` declares an `imageList` field with `minItems` 3 and
  `maxItems` 8
- **THEN** its summary includes `imageRequirement` `{ minItems: 3, maxItems: 8 }`

#### Scenario: Template without an image field

- **WHEN** the current version declares no `imageList` field
- **THEN** its summary has no `imageRequirement`

#### Scenario: Invalid stored manifest

- **WHEN** the stored manifest of a selected version fails schema validation
- **THEN** the request fails and the route error state is shown instead of a partial entry

### Requirement: Template detail page

The system SHALL serve a detail page at `/templates/{templateId}` for a template that satisfies the
same published-current-version rule as the catalog list. The page MUST show the template name,
description, localized mood label, duration label and photo requirement, link back to
`/templates`, and offer a call to action linking to `/studio/new?template={templateId}`. The page
title and description metadata SHALL be the template's `name` and `description`.

#### Scenario: Published template detail

- **WHEN** a visitor opens `/templates/memory-box` and `memory-box` has a published current version
- **THEN** the page shows that version's metadata and a link to `/studio/new?template=memory-box`

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
`imageRequirement` exists and `Không bắt buộc` otherwise. Each card MUST link to
`/templates/{id}`. Templates without a dedicated visual SHALL use a neutral fallback visual (icon
`💝`) rather than failing.

#### Scenario: Known template card

- **WHEN** a card is built for `memory-box` with `estimatedDurationSec` 75, moods `warm` and
  `playful`, and an image requirement of 3 to 8
- **THEN** it shows `Khoảng 75 giây`, `Ấm áp · Bất ngờ` and `3–8 ảnh` with icon `🎁`

#### Scenario: Newly introduced template

- **WHEN** a card is built for an unmapped template id with mood `new-mood` and no image requirement
- **THEN** it shows the mood label `new-mood`, the photo requirement `Không bắt buộc` and icon `💝`

### Requirement: Catalog surfaces and states

The system SHALL render the published catalog both on the home page `/` (section `#templates`,
with a link to `/templates`) and on `/templates`. While `/templates` is loading it MUST show a busy
placeholder (`aria-busy="true"`) with three card skeletons. When the catalog is empty, `/templates`
MUST show an explanatory empty-state message instead of the gallery. When loading the catalog
fails, the route error boundary MUST show a retry action that re-renders the route.

#### Scenario: Home page catalog

- **WHEN** a visitor opens `/` and published templates exist
- **THEN** the home page shows a card for each published template and a `Khám phá template` link to
  `/templates`

#### Scenario: Empty catalog page

- **WHEN** a visitor opens `/templates` and no template is listed
- **THEN** the page shows the empty-state message and no cards

#### Scenario: Catalog load failure

- **WHEN** reading the registry throws while rendering a catalog route
- **THEN** the error boundary is shown with a `Thử lại` retry action

### Requirement: Catalog routes render per request

The system SHALL render `/`, `/templates` and `/templates/{templateId}` dynamically on every request
so that registry changes (publishing, retiring, changing `currentVersion`) are visible without a
rebuild. These public routes MUST NOT carry private gift content and SHALL be served with the
static-compatible CSP (no `strict-dynamic`).

#### Scenario: Registry change becomes visible

- **WHEN** a template's `currentVersion` is changed to another published version in the registry
- **THEN** the next request to `/templates` shows the new version without redeploying

#### Scenario: Public CSP mode

- **WHEN** a visitor requests `/`
- **THEN** the response `Content-Security-Policy` contains `script-src 'self' 'unsafe-inline'` and
  does not contain `strict-dynamic`

### Requirement: Seeded launch templates

The system SHALL provide a seed command (`db:seed`) that idempotently upserts three published
templates, each at version `1.0.0`, in this `sortOrder`: `memory-box` (`Hộp ký ức`),
`our-timeline` (`Dòng thời gian hai đứa`) and `midnight-wish` (`Bầu trời lời nhắn`). Seeding MUST
set each template's `currentVersion` and status from its manifest, store the version under the
identity `{templateId}@{version}` together with its manifest and preview fixture, and MUST abort
if a template has no preview fixture or its preview fixture fails payload validation against the
manifest.

#### Scenario: Seed on an empty database

- **WHEN** `db:seed` runs against an empty database
- **THEN** the catalog lists `memory-box`, `our-timeline` and `midnight-wish`, in that order, each at
  version `1.0.0`

#### Scenario: Re-running the seed

- **WHEN** `db:seed` runs again against an already seeded database
- **THEN** the existing records are updated in place and no duplicate templates or versions are
  created

#### Scenario: Invalid preview fixture

- **WHEN** a seed manifest's preview fixture does not satisfy that manifest's payload rules
- **THEN** seeding fails before writing that template

### Requirement: Retired versions remain resolvable for existing gifts

The system SHALL keep a `retired` template version out of the catalog and out of new gift creation,
while still resolving it by exact `templateId` and `version` when an existing gift draft that pins
that version is edited. New gift drafts MUST only be created against an exact version whose status
is `published`; a version with status `draft` MUST NOT be resolvable for either creation or editing.
Gift draft behavior itself is specified by the gift capabilities.

#### Scenario: Editing a draft pinned to a retired version

- **WHEN** an existing draft pins `memory-box` `1.0.0` and that version is `retired`
- **THEN** the draft's content is still validated and saved against the `1.0.0` manifest

#### Scenario: Editing a draft pinned to a draft-status version

- **WHEN** an existing gift draft pins a template version whose status is `draft`
- **THEN** the edit is refused with `INVALID_STATE`

#### Scenario: Creating a draft on a non-published version

- **WHEN** a new gift draft is requested for a template version that is `retired`, `draft`, or does
  not exist
- **THEN** creation is refused with `NOT_FOUND`
