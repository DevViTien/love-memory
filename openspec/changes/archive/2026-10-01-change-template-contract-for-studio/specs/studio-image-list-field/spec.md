# Spec Delta

## ADDED Requirements

### Requirement: Per-image captions

For a `captionedImageList` field, the Studio image field SHALL show one caption text input per
image, labelled `Chú thích ảnh {n}` where `n` is the image's 1-based position. The input SHALL limit
input to the field's `captionMaxLength` and show the remaining character count. The field SHALL
report its content value as the ordered list of `{ assetId, caption }` items. A caption that is
empty after trimming SHALL be omitted from its item instead of being sent as an empty string. A
caption SHALL stay with its image when the image is reordered, and SHALL be discarded when its
image is cancelled or deleted. Saved captions SHALL be restored for the saved images when the field
mounts. Images recovered after a reload that were never saved SHALL have no caption.

#### Scenario: Caption follows its image

- **WHEN** image A has caption `Biển Nha Trang` and the creator moves image A after image B
- **THEN** the reported content lists B then A, and A still carries `Biển Nha Trang`

#### Scenario: Blank caption omitted

- **WHEN** the creator types only spaces into an image's caption
- **THEN** that image's reported item has no `caption` key

#### Scenario: Caption discarded with its image

- **WHEN** the creator deletes an image that has a caption
- **THEN** the reported content no longer contains that image or its caption

#### Scenario: Caption limit reached

- **WHEN** a field has `captionMaxLength` 140 and the creator types a 150-character caption
- **THEN** the input keeps only 140 characters and shows 0 characters remaining

## MODIFIED Requirements

### Requirement: Field rendering from the template manifest

The draft editor SHALL render one image list field for each `imageList` or `captionedImageList` field of the draft's template version, using that field's `label`, `aspectRatio`, `minItems` and `maxItems`, and seeding it with the asset IDs currently stored in the draft content for that field (for a `captionedImageList` field, the `assetId` of each stored item). The field SHALL show the allowed item range, the accepted formats (JPEG, PNG, WebP) and the 10 MiB per-image limit. Every change to the ordered asset list SHALL be reported to the editor as the field's new content value; an empty list SHALL remove the field from the draft content. Changes SHALL only be persisted when the creator saves the draft.

#### Scenario: Field seeded from saved content

- **WHEN** the editor opens a draft whose content stores two asset IDs for an `imageList` field
- **THEN** the field is rendered with that field's label and aspect ratio and treats those two IDs as the initial order

#### Scenario: Captioned field seeded from saved content

- **WHEN** the editor opens a draft whose content stores two `{ assetId, caption }` items for a `captionedImageList` field
- **THEN** the field treats those two asset IDs as the initial order and shows each saved caption beside its image

#### Scenario: Last image removed

- **WHEN** the creator removes the only image of a field
- **THEN** the field's key is removed from the unsaved draft content
