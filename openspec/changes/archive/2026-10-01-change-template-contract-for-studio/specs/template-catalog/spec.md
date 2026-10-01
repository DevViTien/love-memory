# Spec Delta

## MODIFIED Requirements

### Requirement: Template summary is derived from the stored manifest

The system SHALL build each catalog entry from the stored manifest of the selected version, after
re-validating it against the template manifest schema. A summary MUST expose only `id`, `version`,
`name`, `description`, `estimatedDurationSec`, `moods`, and, when the manifest declares an
`imageList` or `captionedImageList` field, an `imageRequirement` with the first such field's
`minItems` and `maxItems` in declaration order. Stored manifests that fail validation MUST NOT be
rendered as catalog entries.

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

#### Scenario: Invalid stored manifest

- **WHEN** the stored manifest of a selected version fails schema validation
- **THEN** the request fails and the route error state is shown instead of a partial entry

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
- **THEN** the edit is refused with `409` and code `CONFLICT`, and the draft is unchanged

#### Scenario: Creating a draft on a non-published version

- **WHEN** a new gift draft is requested for a template version that is `retired`, `draft`, or does
  not exist
- **THEN** creation is refused with `NOT_FOUND`
