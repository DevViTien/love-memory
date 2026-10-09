# Spec Delta

## MODIFIED Requirements

### Requirement: Admin gift lookup

`/admin` SHALL offer a search field labelled `Tìm món quà` that accepts a gift's `publicId`,
`shareId` or internal id. It SHALL be found by an exact match on one of those three fields, never
by content.

**A match** SHALL show only:

- the internal id, `publicId` and status;
- the template id and version;
- the plan id and `expiresAt`;
- `revision` and `publishedRevision`;
- the creation, update and publication times;
- the owner's user id and email, or `Bản nháp ẩn danh` for an anonymous draft;
- the number of the gift's assets per status.

It MUST NOT show content, captions, field values, asset ids, storage keys, share links or signed
URLs. Only the `shareId` the admin typed may appear, in the search field.

A gift being deleted (`gift-lifecycle`) SHALL be found like any other, with its status `deleting`.
A purged gift SHALL be found by its internal id or `publicId` in its tombstone. The page SHALL then
show `Đã xoá`, the internal id, `publicId`, owner id, and the creation, publication, deletion-request
and deletion times, and nothing else.

**No match** SHALL show `Không tìm thấy món quà nào.`

**Audit.** Every search SHALL record `admin.gift.looked_up`:

- with the gift as target and `{ matched: true }` for a match, including a tombstone;
- without a target and with `{ matched: false }` otherwise.

The searched text MUST NOT be recorded, because a share id is a recipient's credential.

#### Scenario: Lookup by public id

- **WHEN** a stepped-up admin searches for a published gift's `publicId`
- **THEN** the page shows its status `published`, its template, plan, expiry, owner email and asset
  counts, and no caption or text of the gift
- **AND** `admin.gift.looked_up` is recorded with the gift's internal id as target

#### Scenario: Lookup by share id is not leaked

- **WHEN** a stepped-up admin searches for a gift's `shareId`
- **THEN** the gift is found, and the audit record holds the gift's internal id but not the share id

#### Scenario: Nothing found

- **WHEN** a stepped-up admin searches for a value that matches no gift
- **THEN** the page shows `Không tìm thấy món quà nào.`, and the audit record has no target and
  `{ matched: false }`

#### Scenario: Lookup of a deleted gift

- **WHEN** a stepped-up admin searches for the `publicId` of a purged gift
- **THEN** the page shows `Đã xoá` with the gift's ids and times, and no plan, template or asset
  counts
