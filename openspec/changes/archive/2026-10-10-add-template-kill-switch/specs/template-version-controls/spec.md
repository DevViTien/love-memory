# Spec Delta

## Purpose

Lets the operations team take a faulty template version out of service without a code release:
retire it from new gifts, or kill it so every gift falls back to its static rendering, and restore
it once fixed. Every action is audited, and gifts never switch to another version.

## ADDED Requirements

### Requirement: Retire, kill and restore actions

A stepped-up admin (`admin-access` "Admin area guard") SHALL change a stored template version with
`POST /api/admin/template-versions`. The route takes a strict JSON body
`{ "templateId": <string>, "version": <string>, "action": "retire" | "kill" | "restore", "reason"?: "broken" | "security" | "legal" | "other" }`,
where `reason` is required for `kill` and refused otherwise. It passes the guards of
`mutation-request-guards` after the admin guard. The actions are:

- **`retire`**: a `published` version becomes `retired`, and the time of the admin's retire is kept
  on the version.
- **`kill`**: the version is marked killed, with the reason. A `published` version also becomes
  `retired`.
- **`restore`**: the kill mark and its reason are removed. The version stays `retired`.

**Answers:**

- **Success:** `200`, with `data` holding the version's `templateId`, `version`, `status`, `killed`
  and `killReason` (or `null`), and `changed` (`true` or `false`).
- **Unknown version:** `404` with code `NOT_FOUND`.
- **A version with status `draft`:** `409` with code `CONFLICT` and `details.reason`
  `VERSION_NOT_RELEASED`.

**No-ops.** Retiring a retired version, killing a killed version, or restoring a version that is not
killed SHALL answer `200` with `changed: false`, and change and record nothing.

**Audit.** Each change SHALL record, in the same transaction as the change:

- `admin.template.retired`, `admin.template.killed` with `{ reason }`, or `admin.template.restored`;
- the admin as actor;
- the target `{ kind: "template-version", id: "<templateId>@<version>" }`.

No manifest, preview fixture or artifact SHALL change.

#### Scenario: Retire a published version

- **WHEN** a stepped-up admin retires `our-timeline` `1.0.0`
- **THEN** the response is `200` with `status` `retired` and `changed: true`
- **AND** `admin.template.retired` is recorded

#### Scenario: Kill requires a reason

- **WHEN** an admin sends `{ "action": "kill" }` for `memory-box` `1.1.0` without `reason`
- **THEN** the response is `400` with `error.fieldErrors.reason`, and nothing changes

#### Scenario: Repeated kill changes nothing

- **WHEN** an admin kills a version that is already killed
- **THEN** the response is `200` with `changed: false`, and no audit record is added

#### Scenario: Restore keeps the version retired

- **WHEN** an admin restores a killed `memory-box` `1.1.0`
- **THEN** the response has `killed: false` and `status` `retired`, and `admin.template.restored`
  is recorded

#### Scenario: Unknown version

- **WHEN** an admin retires `memory-box` `9.9.9`
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Not an admin

- **WHEN** a creator, or an admin without a step-up, sends the request
- **THEN** the response is `404` `NOT_FOUND`, or `403` with `MFA_REQUIRED` respectively, and
  nothing changes

### Requirement: Effect of a killed version

A killed version SHALL be treated by every capability as a version without a registered template
artifact (`template-artifact-delivery`), from the next request on. In particular:

- **Viewers and preview.** The published gift viewer and the preview show the static rendering of
  the content (`viewer-payload` "Artifact resolution"). The preview also shows its notice for a
  version without an artifact.
- **Publishing.** Publishing, and publishing an update, is refused with `409` and `details.reason`
  `TEMPLATE_VERSION_UNPUBLISHABLE`.
- **The Studio** shows its notice for versions that cannot be published, and `Xuất bản` stays
  disabled.
- **The artifact route** answers `404` (`template-artifact-delivery` "Artifact route").

A killed version is also `retired`, so it is out of the catalog and out of new drafts. Drafts and
published gifts bound to it SHALL stay readable and editable; the share link keeps working. A gift
MUST NOT be served another version of the template. After a restore, the version's artifact SHALL
be used again from the next request.

#### Scenario: Published gift on a killed version

- **WHEN** a recipient opens the share link of a gift published on `memory-box` `1.1.0` after an
  admin killed that version
- **THEN** the page loads with `artifactUrl` `null`, shows the gift's content in the static
  rendering after `Mở quà`, and loads no template iframe

#### Scenario: Publish refused while killed

- **WHEN** an owner publishes a draft bound to a killed version
- **THEN** the response is `409` with `details.reason` `TEMPLATE_VERSION_UNPUBLISHABLE`, and
  nothing is published

#### Scenario: Restore brings the template back

- **WHEN** an admin restores the version and the recipient reloads the share link
- **THEN** the viewer loads the template iframe again

### Requirement: Admin template page

`/admin/templates` SHALL be an admin page (`admin-access` "Admin area guard"). It SHALL list every
stored template version, ordered by template id and then version, newest first. For each version it
SHALL show:

- `templateId` and `version`;
- its status;
- `Phiên bản hiện tại` when it is the template's current version;
- whether a template artifact is registered;
- `Đã tắt` and the kill reason when it is killed.

It SHALL offer the actions that would change the version:

- `Ngừng phát hành` for a `published` version;
- `Tắt khẩn cấp` with a reason for a version that is not killed;
- `Khôi phục` for a killed version.

Each action asks for confirmation, and the list reflects the result. The admin shell SHALL link to
the page as `Mẫu quà`. Viewing the page SHALL NOT be recorded.

#### Scenario: Admin kills a version from the page

- **WHEN** a stepped-up admin chooses `Tắt khẩn cấp` with the reason `broken` for a version and
  confirms
- **THEN** the row shows `Đã tắt` and `broken`, offers `Khôi phục`, and the audit page lists
  `admin.template.killed`

#### Scenario: Creator sees nothing

- **WHEN** a signed-in creator opens `/admin/templates`
- **THEN** the not-found page is rendered with HTTP `404`
