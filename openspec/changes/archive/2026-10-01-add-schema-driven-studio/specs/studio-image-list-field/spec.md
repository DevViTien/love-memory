## MODIFIED Requirements

### Requirement: Field rendering from the template manifest

The draft editor SHALL render one image list field for each `imageList` or `captionedImageList` field of the draft's template version, using that field's `label`, `aspectRatio`, `minItems` and `maxItems`, and seeding it with the asset IDs currently stored in the draft content for that field (for a `captionedImageList` field, the `assetId` of each stored item). The field SHALL show the allowed item range, the accepted formats (JPEG, PNG, WebP) and the 10 MiB per-image limit. It SHALL show how many images it holds against `maxItems` as `{n}/{maxItems} ảnh`, and, while it holds fewer than `minItems` images, how many more are needed as `Cần thêm {k} ảnh`. Every change to the ordered asset list SHALL be reported to the editor as the field's new content value; an empty list SHALL remove the field from the draft content. Changes SHALL be persisted by the Studio autosave specified in `studio-autosave`, without a separate save action, including while the field holds fewer than `minItems` images. The field SHALL keep its uploads running while the creator moves to another Studio step.

#### Scenario: Field seeded from saved content

- **WHEN** the editor opens a draft whose content stores two asset IDs for an `imageList` field
- **THEN** the field is rendered with that field's label and aspect ratio and treats those two IDs as the initial order

#### Scenario: Captioned field seeded from saved content

- **WHEN** the editor opens a draft whose content stores two `{ assetId, caption }` items for a `captionedImageList` field
- **THEN** the field treats those two asset IDs as the initial order and shows each saved caption beside its image

#### Scenario: Last image removed

- **WHEN** the creator removes the only image of a field
- **THEN** the field's key is removed from the unsaved draft content

#### Scenario: Image count below the minimum

- **WHEN** a field with `minItems` 3 and `maxItems` 8 holds one image
- **THEN** the field shows `1/8 ảnh` and `Cần thêm 2 ảnh`

#### Scenario: New image persisted by autosave

- **WHEN** the creator uploads the first image of a field with `minItems` 3 and makes no other change
- **THEN** the field reports the new order, the Studio autosaves it without any save action, and the stored draft lists that asset ID for the field

#### Scenario: Upload continues on another step

- **WHEN** an upload is at 40% and the creator moves to another Studio step
- **THEN** the upload is not aborted, and the image appears in the field when the creator returns
