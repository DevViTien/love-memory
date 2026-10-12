# Studio Image List Field

## Purpose

Defines how the Studio draft editor lets a creator fill an `imageList` template field: picking several images, cropping each to the template's aspect ratio in the browser, uploading with progress, and then managing the uploaded images (cancel, delete, retry, reorder) until they are ready. The field only edits the ordered list of asset IDs in the unsaved draft content; the upload and asset APIs it calls are specified in `media-upload`, processing is specified in `media-processing`, and saving the draft is specified in `gift-drafts`.

## Requirements

### Requirement: Field rendering from the template manifest

The draft editor SHALL render one image list field for each `imageList` or `captionedImageList` field of the draft's template version, using that field's `label`, `aspectRatio`, `minItems` and `maxItems`, and seeding it with the asset IDs currently stored in the draft content for that field (for a `captionedImageList` field, the `assetId` of each stored item). The field SHALL show the allowed item range, the accepted formats (JPEG, PNG, WebP) and the 10 MiB per-image limit. It SHALL show how many images it holds against `maxItems` as `{n}/{maxItems} ảnh`, and, while it holds fewer than `minItems` images, how many more are needed as `Cần thêm {k} ảnh`. Every change to the ordered asset list SHALL be reported to the editor as the field's new content value; an empty list SHALL remove the field from the draft content. Changes SHALL be persisted by the Studio autosave specified in `studio-autosave`, without a separate save action, including while the field holds fewer than `minItems` images. The field SHALL keep its uploads running while the creator moves to another Studio step. An `image` field SHALL be rendered as the same field limited to one image: `maxItems` 1, `minItems` 1 when the field is required and 0 otherwise, the field's `aspectRatio` or `1:1`, the summary `Một ảnh` instead of the item range, seeded with the stored asset id, and reporting that single asset id as its value; removing the photo removes the field from the draft content.

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

#### Scenario: Single photo field

- **WHEN** the editor opens a draft whose `image` field stores one asset id
- **THEN** the field shows `Một ảnh`, `1/1 ảnh` and that photo, and its picker is disabled until
  the photo is removed

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

After cropping, the field SHALL request an upload grant from `POST /api/media/uploads/init` with the cropped file's type, size and name, add the new asset to the end of the list in status `initiated` with 0% progress, and report the new order immediately. From then until the asset is `ready`, the item SHALL show the cropped image itself as its preview, from a browser-local object URL of the cropped file that is never uploaded, stored or sent to the server, and that is released when the item is removed, when its signed derivative is shown, or when the field unmounts. It SHALL upload the file directly to the granted URL with `PUT` and the granted headers, showing the upload percentage over the preview as a progress bar with `role="progressbar"`, `aria-valuemin` `0`, `aria-valuemax` `100` and `aria-valuenow` set to the percentage, together with the text `Đang tải lên {n}%`. A transfer that reports no progress for 30 seconds SHALL be aborted. When the transfer fails or is aborted for that reason (not cancelled by the creator), the field SHALL delete the new asset through `DELETE /api/media/assets/{assetId}`, remove its item, report the new order and show `Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này.`, so that no item is left with an action that cannot succeed; when that deletion fails, the item stays with its delete action. When the upload finishes it SHALL call `POST /api/media/uploads/complete`, retrying automatically up to 3 attempts in total with a delay of 250 milliseconds times the attempt number when the request fails at the network level, returns `429`, returns a `5xx` status, or returns a success status with an unreadable body. Other errors SHALL stop the retries. A completion answered with `409` SHALL NOT be shown as an error by itself: the field SHALL read the asset through `GET /api/media/assets/{assetId}` and, when it is `uploaded`, `processing` or `ready`, update the item from that answer exactly as after a successful completion; when it is `failed` or `deleting`, update the item and show the completion conflict message of the "Creator-facing media error messages" requirement; when the read answers `404`, remove the item and report the new order. A grant or completion request that has not answered within 15 seconds SHALL be aborted; for completion this counts as a network-level failure. Grant, upload and completion errors SHALL be shown as a Vietnamese message as specified in "Creator-facing media error messages", never as the server's message.

#### Scenario: Successful upload

- **WHEN** the creator confirms a crop and the grant, upload and completion all succeed
- **THEN** the item takes the returned status (for example `uploaded`) and the asset ID stays in the reported order

#### Scenario: Local thumbnail while uploading

- **WHEN** the creator confirms a crop and the `PUT` is at 40%
- **THEN** the item shows the cropped image as its preview, a progress bar with `aria-valuenow` `40` and the text `Đang tải lên 40%`

#### Scenario: Completion temporarily unavailable

- **WHEN** the first completion request returns `503` and the second succeeds
- **THEN** the item is updated from the second response without any creator action

#### Scenario: Late duplicate completion

- **WHEN** a completion request answers `409` because an earlier, timed-out completion of the same asset already moved it to `uploaded`
- **THEN** the field reads the asset, shows it as processing, and shows no error message

#### Scenario: Grant refused

- **WHEN** `POST /api/media/uploads/init` responds with an error such as `429`
- **THEN** no item is added and the Vietnamese message for that error is shown instead of the server's message

#### Scenario: Transfer interrupted

- **WHEN** the `PUT` of a new image fails with a network error at 30%
- **THEN** the field deletes that asset, removes its item, and shows `Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này.`, and no `Hoàn tất tải lên` action is offered for it

#### Scenario: Transfer stalls

- **WHEN** a `PUT` reports no progress for 30 seconds
- **THEN** the transfer is aborted and handled as an interrupted transfer

### Requirement: Processing status and preview refresh

While any item is `uploaded` or `processing`, the field SHALL poll every 1500 milliseconds by listing the gift's assets with `includeDownloadUrls=false`, update those items' status, and, for each item that has become `ready`, read that asset individually to obtain its signed derivative URLs. Each item SHALL show a preview in the template aspect ratio, using the first derivative URL when available, otherwise the local cropped image of an upload made in this page, otherwise the placeholder image, otherwise a neutral box; its file name, or `Ảnh {n}` (its 1-based position) when the name is unknown; and, while it is not `ready`, its status label inside a polite live region (`aria-live="polite"`), so status changes are announced without announcing every progress step. While an item is `uploaded` or `processing`, its preview SHALL carry an overlay with a spinner, which does not animate when the creator prefers reduced motion, and the text `Đang xử lý ảnh…`. When an item has stayed `uploaded` or `processing` for 45 seconds while the field is open, the field SHALL show for that item "Ảnh đang được xử lý lâu hơn bình thường. Bạn có thể tiếp tục viết, ảnh sẽ tự cập nhật." inside the same live region and keep polling. Status labels are Vietnamese: `initiated` → `Đang tải lên`, `uploaded` and `processing` → `Đang xử lý`, `failed` → `Lỗi xử lý`, `deleting` → `Đang xóa`. A `failed` item SHALL also state the next step: `Bấm “Thử lại” để xử lý lại ảnh.` when its `failureCode` is `PROCESSING_FAILED`, otherwise `Không đọc được ảnh này. Hãy xóa và chọn ảnh khác.` Raw status values, failure codes and asset IDs MUST NOT be shown. Polling SHALL stop when no item is `uploaded` or `processing`.

#### Scenario: Processing finishes

- **WHEN** an item that was `processing` is listed as `ready` during polling
- **THEN** the field reads that asset, shows its derivative image as the preview in place of the local image and stops polling if no other item is pending

#### Scenario: Processing overlay on the local image

- **WHEN** a completed upload made in this page is `uploaded`
- **THEN** the item shows the cropped image with a spinner overlay and `Đang xử lý ảnh…`

#### Scenario: Slow processing

- **WHEN** an item has been `processing` for 45 seconds and polling still lists it as `processing`
- **THEN** the item shows "Ảnh đang được xử lý lâu hơn bình thường. Bạn có thể tiếp tục viết, ảnh sẽ tự cập nhật." and polling continues every 1500 milliseconds

#### Scenario: Labels instead of raw values

- **WHEN** a recovered item has no known file name and status `processing`
- **THEN** it shows `Ảnh 1` (for the first item) and `Đang xử lý`, and neither its asset ID nor `processing` appears on the page

### Requirement: Cancel and delete

Every item SHALL offer a delete action. Deleting SHALL first abort that item's in-flight upload, if any, without showing an error for the cancellation, and SHALL then call `DELETE /api/media/assets/{assetId}` with the gift's `giftPublicId`. While that request runs, the item's delete action SHALL be disabled and read `Đang xóa…`, so a repeated click cannot send a second request. On success the item SHALL be removed and the new order reported. A `404` answer means the asset no longer exists, so the item SHALL likewise be removed and the new order reported, without an error message. On any other failure the item SHALL stay and the Vietnamese message for the refusal SHALL be shown (see "Creator-facing media error messages"), or `Chưa xóa được ảnh — thử lại.` when the request fails at the network level. A failed processing retry SHALL likewise show a message instead of failing silently. Leaving the editor SHALL abort every in-flight upload of the field, and after that the field SHALL send no new request and SHALL NOT report any order or change to the editor, so an unmounted field (for example after `Tải bản mới nhất` re-seeds the image fields) can never overwrite newer content.

#### Scenario: Cancel an in-progress upload

- **WHEN** the creator deletes an item whose upload is at 40%
- **THEN** the upload request is aborted, the asset is deleted through the API, and the item disappears without an error message

#### Scenario: Double click on delete

- **WHEN** the creator clicks the delete action of an item twice before the first request answers
- **THEN** only one `DELETE` request is sent and no conflict message is shown

#### Scenario: Asset already gone

- **WHEN** the delete request answers `404`
- **THEN** the item is removed, the new order is reported and no error message is shown

#### Scenario: Delete refused

- **WHEN** the delete request fails with `409`
- **THEN** the item remains in the list and `Ảnh đang được cập nhật — hãy thử xóa lại sau giây lát.` is shown instead of the server's message

#### Scenario: Delete without a connection

- **WHEN** the delete request fails at the network level
- **THEN** the item remains in the list and `Chưa xóa được ảnh — thử lại.` is shown

#### Scenario: Field unmounted during an upload

- **WHEN** the field is unmounted while its upload grant request is still in flight
- **THEN** no upload is started for that grant, and the field reports no order to the editor afterwards

### Requirement: Retry only for recoverable states

The field SHALL show a processing retry action only for items whose status is `failed` and whose `failureCode` is `PROCESSING_FAILED`; it SHALL call `POST /api/media/assets/{assetId}/retry`, keep that action disabled while the request runs, and then reload the field's assets, or show the Vietnamese message for the refusal (for example when the retry limit is reached). Items that failed with any other failure code SHALL offer only delete. Items still in status `initiated`, such as an upload whose completion did not succeed, SHALL offer a complete-upload action that repeats the completion request and is disabled while that request is running.

#### Scenario: Terminal failure has no retry

- **WHEN** an item is `failed` with `failureCode` `DECODE_FAILED`
- **THEN** no retry action is shown and the creator can only delete it

#### Scenario: Transient failure retried

- **WHEN** the creator retries an item that is `failed` with `failureCode` `PROCESSING_FAILED`
- **THEN** the retry endpoint is called and the item is refreshed from the asset list

#### Scenario: Retry refused

- **WHEN** the retry request answers `409` with code `CONFLICT`
- **THEN** `Ảnh này không thể xử lý lại nữa. Hãy xóa và chọn lại ảnh.` is shown instead of the server's message

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

### Requirement: Creator-facing media error messages

The image field MUST NOT show a server-provided error message or any other English text from a media API response. It SHALL choose Vietnamese copy from the operation and the response's status and error code:

- `RATE_LIMITED` on `POST /api/media/uploads/init`: `Bạn đang tải ảnh hơi nhanh. Hãy thử lại sau ít phút.` when the response has a `Retry-After` header, otherwise (the gift's image quota) `Món quà đã đạt giới hạn số ảnh.`
- `VALIDATION_ERROR` on upload initialization: `Ảnh này không được hỗ trợ. Hãy chọn ảnh JPEG, PNG hoặc WebP dưới 10 MB.`
- `VALIDATION_ERROR` on completion: `Ảnh tải lên bị lỗi hoặc không đầy đủ. Hãy xóa và chọn lại ảnh này.`
- `CONFLICT` on completion, after the asset was read as `failed` or `deleting`: `Ảnh này không thể hoàn tất tải lên nữa. Hãy xóa và chọn lại ảnh.`
- `CONFLICT` on delete: `Ảnh đang được cập nhật — hãy thử xóa lại sau giây lát.`
- `CONFLICT` on retry: `Ảnh này không thể xử lý lại nữa. Hãy xóa và chọn lại ảnh.`
- `NOT_FOUND` on any other operation: `Không tìm thấy món quà hoặc ảnh này nữa. Hãy tải lại trang.`
- `UNAUTHORIZED` or `FORBIDDEN`: `Bạn không có quyền thay đổi ảnh của món quà này.`
- `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` or any `5xx` status: `Hệ thống đang bận. Hãy thử lại sau ít phút.`
- Any other or unreadable error response: `Chưa thực hiện được thao tác với ảnh — thử lại.`

A crop that fails SHALL show `Không cắt được ảnh này — hãy thử lại hoặc chọn ảnh khác.` in the crop dialog. A shown message SHALL be cleared when the creator starts a new selection or starts a delete, retry or complete-upload action, so a message never outlives the problem it describes.

#### Scenario: Raw server message never shown

- **WHEN** `POST /api/media/uploads/init` answers `400` with code `VALIDATION_ERROR` and an English message
- **THEN** the field shows `Ảnh này không được hỗ trợ. Hãy chọn ảnh JPEG, PNG hoặc WebP dưới 10 MB.` and the English message does not appear on the page

#### Scenario: Server failure during completion

- **WHEN** all three completion attempts answer `500` with code `INTERNAL_ERROR`
- **THEN** the field shows `Hệ thống đang bận. Hãy thử lại sau ít phút.` and the item keeps its `Hoàn tất tải lên` action

#### Scenario: Old message cleared

- **WHEN** a delete refusal message is shown and the creator then starts a new selection
- **THEN** the message disappears
