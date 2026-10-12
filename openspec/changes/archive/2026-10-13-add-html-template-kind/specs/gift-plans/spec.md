## MODIFIED Requirements

### Requirement: Plan catalog

The system SHALL offer exactly these plan versions, identified by `planId` and `planVersion`:

| `planId`   | `planVersion` | Name         | `priceVnd` | `maxPhotos` | `watermark` | `retentionDays` | `passwordAccess` | `scheduledAccess` |
| ---------- | ------------- | ------------ | ---------- | ----------- | ----------- | --------------- | ---------------- | ----------------- |
| `free`     | `1`           | `Miễn phí`   | `0`        | `3`         | `true`      | `14`            | `false`          | `false`           |
| `standard` | `1`           | `Tiêu chuẩn` | `49000`    | `null`      | `false`     | `365`           | `true`           | `true`            |

`priceVnd` is an integer amount in Vietnamese đồng. `maxPhotos` `null` means that only the
template's own limits apply. A released plan version MUST NOT change. Changing a price, limit or
capability SHALL release a new `planVersion`, and an entitlement already granted keeps the values
of the version it was granted from. The current version of each plan is the one offered for new
publishes. The catalog SHALL hold no other plan.

The photo count of a gift's content SHALL be the number of image items across all of the template's
image fields; the photo of an `image` field counts as one item. It is counted from the content being published, never from uploaded assets.

#### Scenario: Plans offered

- **WHEN** an owner opens the `Xuất bản` step of a draft
- **THEN** exactly the plans `free` version `1` and `standard` version `1` are offered, with the
  values of the table

#### Scenario: Photo count

- **WHEN** a `memory-box` `1.1.0` gift's `memories` field holds 5 items
- **THEN** its photo count is `5`

#### Scenario: Photo count with single photo fields

- **WHEN** a `love-days` gift holds a `photo` and one of its two avatars
- **THEN** its photo count is `2`, so it can be published on `free`
