## MODIFIED Requirements

### Requirement: Multi-image picking with client-side validation

The field SHALL offer a file picker that allows selecting multiple files and accepts `image/jpeg`, `image/png` and `image/webp`. The picker SHALL be disabled while a previous selection is still being cropped or uploaded, while a crop dialog is open, or when the field already holds `maxItems` images. When more files are selected than the remaining capacity, the field SHALL keep only as many files as fit, in selection order, and SHALL show a message stating the maximum. Each file SHALL be checked before cropping: a file with another type, an empty file, or a file larger than 10 MiB SHALL be skipped with an error message naming the file. Selected files SHALL be cropped and uploaded one at a time.

#### Scenario: Too many files selected

- **WHEN** a field with `maxItems` 5 already holds 3 images and the creator selects 4 files
- **THEN** only the first 2 files are processed and a message states that at most 5 images are allowed

#### Scenario: Unsupported file skipped

- **WHEN** the creator selects a GIF file together with a JPEG file
- **THEN** the GIF is skipped with an error message naming it and the JPEG continues to the crop dialog

#### Scenario: No second selection while uploading

- **WHEN** the first file of a selection is still uploading
- **THEN** the picker is disabled until every file of that selection has been cropped or skipped and uploaded

### Requirement: Client-side aspect-ratio crop

For each accepted file the field SHALL open a modal crop dialog that previews the image in the template's `aspectRatio` and offers horizontal and vertical focal-point sliders from 0 to 1, both starting at 0.5. Confirming SHALL crop the largest region of the source image that has the target aspect ratio, positioned along the free axis by the focal point and honoring the image's EXIF orientation, SHALL scale the result down so neither side exceeds 2048 pixels, and SHALL request WebP encoding at quality 0.9. When the browser cannot encode WebP (it returns `image/png` or `image/jpeg`), the field SHALL encode the crop again as JPEG at quality 0.9, so a lossless PNG is not uploaded. The uploaded file's type and extension SHALL match the format the browser actually produced: `image/webp` named `<original name without extension>-cropped.webp`, `image/jpeg` with a `.jpg` extension, or, only if the browser cannot produce JPEG either, `image/png` with a `.png` extension. Only the cropped file SHALL be uploaded. Skipping SHALL discard that file and continue with the next one. If cropping fails, the dialog SHALL stay open and show the error.

#### Scenario: Landscape photo cropped to a square frame

- **WHEN** a 4000x2000 photo is confirmed for a field with `aspectRatio` `1:1` and a horizontal focal point of 0
- **THEN** the uploaded file is the 2000x2000 region at the left edge of the photo, encoded as `image/webp`

#### Scenario: Browser without WebP canvas encoding

- **WHEN** the browser returns a PNG from the WebP encoding request
- **THEN** the crop is encoded again and uploaded as `image/jpeg` with a `-cropped.jpg` name, instead of an `image/png` `-cropped.png` file, so processing does not reject it as `UPLOAD_INVALID`

#### Scenario: Crop skipped

- **WHEN** the creator chooses to skip an image in the crop dialog
- **THEN** no upload is started for that file and the next selected file, if any, is offered for cropping

### Requirement: Recovery after reload

When the field mounts, it SHALL list all non-deleted assets of the gift, keep those belonging to this field, and order them by the saved draft order, placing assets missing from the saved order after the saved ones in creation order. If the recovered order differs from the saved one, including when none of the saved assets still exists, the field SHALL report the recovered order to the editor. Recovered items in status `initiated` SHALL offer the complete-upload action so an upload interrupted by a reload can be completed. If the list cannot be loaded, the field SHALL show a message that the uploaded images could not be restored.

#### Scenario: Unsaved upload recovered

- **WHEN** the creator uploads an image and reloads the page before saving the draft
- **THEN** the image reappears at the end of the field and its asset ID is reported as part of the field's content

#### Scenario: Interrupted completion recovered

- **WHEN** the page reloads while an asset is still `initiated`
- **THEN** the item shows a complete-upload action that calls `POST /api/media/uploads/complete` for that asset

#### Scenario: Saved assets no longer exist

- **WHEN** the saved draft lists asset IDs for the field but none of those assets exists any more
- **THEN** the field reports an empty order, so the draft can be saved again
