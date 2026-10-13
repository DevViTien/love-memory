## MODIFIED Requirements

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

- **WHEN** a stepped-up admin retires `love-days` `1.0.0`
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
