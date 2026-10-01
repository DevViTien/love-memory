## MODIFIED Requirements

### Requirement: Direct upload with progress and automatic completion

After cropping, the field SHALL request an upload grant from `POST /api/media/uploads/init` with the cropped file's type, size and name, add the new asset to the end of the list in status `initiated` with 0% progress, and report the new order immediately. It SHALL upload the file directly to the granted URL with `PUT` and the granted headers, showing the upload percentage while no preview exists. A transfer that reports no progress for 30 seconds SHALL be aborted. When the transfer fails or is aborted for that reason (not cancelled by the creator), the field SHALL delete the new asset through `DELETE /api/media/assets/{assetId}`, remove its item, report the new order and show `Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này.`, so that no item is left with an action that cannot succeed; when that deletion fails, the item stays with its delete action. When the upload finishes it SHALL call `POST /api/media/uploads/complete`, retrying automatically up to 3 attempts in total with a delay of 250 milliseconds times the attempt number when the request fails at the network level, returns `429`, returns a `5xx` status, or returns a success status with an unreadable body. Other errors SHALL stop the retries. A grant or completion request that has not answered within 15 seconds SHALL be aborted; for completion this counts as a network-level failure. Grant, upload and completion errors SHALL be shown as a message.

#### Scenario: Successful upload

- **WHEN** the creator confirms a crop and the grant, upload and completion all succeed
- **THEN** the item shows the returned status (for example `uploaded`) and the asset ID stays in the reported order

#### Scenario: Completion temporarily unavailable

- **WHEN** the first completion request returns `503` and the second succeeds
- **THEN** the item is updated from the second response without any creator action

#### Scenario: Grant refused

- **WHEN** `POST /api/media/uploads/init` responds with an error such as `429`
- **THEN** no item is added and the API error message is shown

#### Scenario: Transfer interrupted

- **WHEN** the `PUT` of a new image fails with a network error at 30%
- **THEN** the field deletes that asset, removes its item, and shows `Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này.`, and no `Hoàn tất tải lên` action is offered for it

#### Scenario: Transfer stalls

- **WHEN** a `PUT` reports no progress for 30 seconds
- **THEN** the transfer is aborted and handled as an interrupted transfer

### Requirement: Processing status and preview refresh

While any item is `uploaded` or `processing`, the field SHALL poll every 1500 milliseconds by listing the gift's assets with `includeDownloadUrls=false`, update those items' status, and, for each item that has become `ready`, read that asset individually to obtain its signed derivative URLs. Each item SHALL show a preview in the template aspect ratio, using the first derivative URL when available, otherwise the placeholder image, otherwise the upload percentage or the status label; its file name, or `Ảnh {n}` (its 1-based position) when the name is unknown; and, while it is not `ready`, its status label. Status labels are Vietnamese: `initiated` → `Đang tải lên`, `uploaded` and `processing` → `Đang xử lý`, `failed` → `Lỗi xử lý`, `deleting` → `Đang xóa`. Raw status values and asset IDs MUST NOT be shown. Polling SHALL stop when no item is `uploaded` or `processing`.

#### Scenario: Processing finishes

- **WHEN** an item that was `processing` is listed as `ready` during polling
- **THEN** the field reads that asset, shows its derivative image as the preview and stops polling if no other item is pending

#### Scenario: Labels instead of raw values

- **WHEN** a recovered item has no known file name and status `processing`
- **THEN** it shows `Ảnh 1` (for the first item) and `Đang xử lý`, and neither its asset ID nor `processing` appears on the page

### Requirement: Cancel and delete

Every item SHALL offer a delete action. Deleting SHALL first abort that item's in-flight upload, if any, without showing an error for the cancellation, and SHALL then call `DELETE /api/media/assets/{assetId}` with the gift's `giftPublicId`. On success the item SHALL be removed and the new order reported; on failure the item SHALL stay and the API error message SHALL be shown, or `Chưa xóa được ảnh — thử lại.` when the request fails at the network level. A failed processing retry SHALL likewise show a message instead of failing silently. Leaving the editor SHALL abort every in-flight upload of the field, and after that the field SHALL send no new request and SHALL NOT report any order or change to the editor, so an unmounted field (for example after `Tải bản mới nhất` re-seeds the image fields) can never overwrite newer content.

#### Scenario: Cancel an in-progress upload

- **WHEN** the creator deletes an item whose upload is at 40%
- **THEN** the upload request is aborted, the asset is deleted through the API, and the item disappears without an error message

#### Scenario: Delete refused

- **WHEN** the delete request fails with `409`
- **THEN** the item remains in the list and the API error message is shown

#### Scenario: Delete without a connection

- **WHEN** the delete request fails at the network level
- **THEN** the item remains in the list and `Chưa xóa được ảnh — thử lại.` is shown

#### Scenario: Field unmounted during an upload

- **WHEN** the field is unmounted while its upload grant request is still in flight
- **THEN** no upload is started for that grant, and the field reports no order to the editor afterwards
