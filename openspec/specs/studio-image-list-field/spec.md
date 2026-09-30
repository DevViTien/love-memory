# Studio Image List Field

## Purpose

Defines how the Studio draft editor lets a creator fill an `imageList` template field: picking several images, cropping each to the template's aspect ratio in the browser, uploading with progress, and then managing the uploaded images (cancel, delete, retry, reorder) until they are ready. The field only edits the ordered list of asset IDs in the unsaved draft content; the upload and asset APIs it calls are specified in `media-upload`, processing is specified in `media-processing`, and saving the draft is specified in `gift-drafts`.

## Requirements

### Requirement: Field rendering from the template manifest

The draft editor SHALL render one image list field for each `imageList` field of the draft's template version, using that field's `label`, `aspectRatio`, `minItems` and `maxItems`, and seeding it with the asset IDs currently stored in the draft content for that field. The field SHALL show the allowed item range, the accepted formats (JPEG, PNG, WebP) and the 10 MiB per-image limit. Every change to the ordered asset list SHALL be reported to the editor as the field's new content value; an empty list SHALL remove the field from the draft content. Changes SHALL only be persisted when the creator saves the draft.

#### Scenario: Field seeded from saved content

- **WHEN** the editor opens a draft whose content stores two asset IDs for an `imageList` field
- **THEN** the field is rendered with that field's label and aspect ratio and treats those two IDs as the initial order

#### Scenario: Last image removed

- **WHEN** the creator removes the only image of a field
- **THEN** the field's key is removed from the unsaved draft content

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

### Requirement: Direct upload with progress and automatic completion

After cropping, the field SHALL request an upload grant from `POST /api/media/uploads/init` with the cropped file's type, size and name, add the new asset to the end of the list in status `initiated` with 0% progress, and report the new order immediately. It SHALL upload the file directly to the granted URL with `PUT` and the granted headers, showing the upload percentage while no preview exists. When the upload finishes it SHALL call `POST /api/media/uploads/complete`, retrying automatically up to 3 attempts in total with a delay of 250 milliseconds times the attempt number when the request fails at the network level, returns `429`, returns a `5xx` status, or returns a success status with an unreadable body. Other errors SHALL stop the retries. Grant, upload and completion errors SHALL be shown as a message.

#### Scenario: Successful upload

- **WHEN** the creator confirms a crop and the grant, upload and completion all succeed
- **THEN** the item shows the returned status (for example `uploaded`) and the asset ID stays in the reported order

#### Scenario: Completion temporarily unavailable

- **WHEN** the first completion request returns `503` and the second succeeds
- **THEN** the item is updated from the second response without any creator action

#### Scenario: Grant refused

- **WHEN** `POST /api/media/uploads/init` responds with an error such as `429`
- **THEN** no item is added and the API error message is shown

### Requirement: Processing status and preview refresh

While any item is `uploaded` or `processing`, the field SHALL poll every 1500 milliseconds by listing the gift's assets with `includeDownloadUrls=false`, update those items' status, and, for each item that has become `ready`, read that asset individually to obtain its signed derivative URLs. Each item SHALL show its status, its file name (or asset ID when the name is unknown) and a preview in the template aspect ratio, using the first derivative URL when available, otherwise the placeholder image, otherwise the upload percentage or status text. Polling SHALL stop when no item is `uploaded` or `processing`.

#### Scenario: Processing finishes

- **WHEN** an item that was `processing` is listed as `ready` during polling
- **THEN** the field reads that asset, shows its derivative image as the preview and stops polling if no other item is pending

### Requirement: Cancel and delete

Every item SHALL offer a delete action. Deleting SHALL first abort that item's in-flight upload, if any, without showing an error for the cancellation, and SHALL then call `DELETE /api/media/assets/{assetId}` with the gift's `giftPublicId`. On success the item SHALL be removed and the new order reported; on failure the item SHALL stay and the API error message SHALL be shown. Leaving the editor SHALL abort every in-flight upload of the field.

#### Scenario: Cancel an in-progress upload

- **WHEN** the creator deletes an item whose upload is at 40%
- **THEN** the upload request is aborted, the asset is deleted through the API, and the item disappears without an error message

#### Scenario: Delete refused

- **WHEN** the delete request fails with `409`
- **THEN** the item remains in the list and the API error message is shown

### Requirement: Retry only for recoverable states

The field SHALL show a processing retry action only for items whose status is `failed` and whose `failureCode` is `PROCESSING_FAILED`; it SHALL call `POST /api/media/assets/{assetId}/retry` and then reload the field's assets, or show the API error message (for example when the retry limit is reached). Items that failed with any other failure code SHALL offer only delete. Items still in status `initiated`, such as an upload whose completion did not succeed, SHALL offer a complete-upload action that repeats the completion request and is disabled while that request is running.

#### Scenario: Terminal failure has no retry

- **WHEN** an item is `failed` with `failureCode` `DECODE_FAILED`
- **THEN** no retry action is shown and the creator can only delete it

#### Scenario: Transient failure retried

- **WHEN** the creator retries an item that is `failed` with `failureCode` `PROCESSING_FAILED`
- **THEN** the retry endpoint is called and the item is refreshed from the asset list

### Requirement: Reordering

Each item SHALL offer move-earlier and move-later actions that swap it with its neighbor; move-earlier SHALL be disabled for the first item and move-later for the last. Every reorder SHALL report the new asset order to the editor so the next draft save stores it.

#### Scenario: Move an image earlier

- **WHEN** the creator moves the second image earlier
- **THEN** the first two images swap places and the reported order lists the moved asset first

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

### Requirement: Not-ready media status notice

While any item of the field is not `ready`, the field SHALL display a status notice (with `role="status"`) telling the creator that the gift cannot be published until every image has finished processing or failed images are removed. The notice SHALL disappear once all items are `ready` or the list is empty. The notice is advisory: saving the draft SHALL remain available while images are not ready.

#### Scenario: Image still processing

- **WHEN** one item is `processing` and the others are `ready`
- **THEN** the status notice is shown

#### Scenario: All images ready

- **WHEN** every item is `ready`
- **THEN** no status notice is shown
