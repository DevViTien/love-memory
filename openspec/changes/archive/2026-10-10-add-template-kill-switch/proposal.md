# Add template kill switch

## Why

A template version that turns out broken, unsafe or legally problematic keeps running for every gift
that pins it, and only a code release or a database edit can stop it. Plan.md §15.1 asks admins to
retire and kill template versions, and Gate M5 (§15.7) requires that "Template lỗi có thể
retire/kill". This is Sprint 6 change 3 ([sprint-6-plan.md](../../../docs/sprints/sprint-6-plan.md)).

## What Changes

- **Retire.** A stepped-up admin can retire a `published` template version from `/admin/templates`.
  It leaves the catalog and new drafts at once. Existing drafts and published gifts keep working, as
  they already do for retired versions.
- **Kill.** A stepped-up admin can kill a version, with a reason (`broken`, `security`, `legal` or
  `other`). A killed version is also retired, and it is treated everywhere as a version without a
  registered template artifact:
  - published gifts and previews show the static rendering of their content instead of the
    template;
  - publishing and update-publishing are refused, as for any version without an artifact;
  - the Studio shows the existing "cannot be published" notice;
  - the artifact route answers `404` for its files.
- **Restore.** An admin can restore a killed version: its artifact is used again. It stays retired;
  bringing a version back into the catalog is a code release, not an admin action.
- **Audit.** Each change records `admin.template.retired`, `admin.template.killed` (with the
  reason) or `admin.template.restored`. Repeating an action that is already in effect changes and
  records nothing.
- **Seed.** `db:seed` no longer turns a version that an admin retired or killed back into
  `published`.
- **Admin page.** `/admin/templates` lists every stored version, with its status, whether it is the
  template's current version, whether an artifact is registered, and its kill state, plus the
  actions above. The admin shell gains a `Mẫu quà` link.

## Capabilities

### New Capabilities

- `template-version-controls`: the admin retire, kill and restore actions, their effects, the admin
  page and route, and how a kill overrides artifact availability.

### Modified Capabilities

- `viewer-payload`: "Artifact resolution": a killed version resolves no artifact.
- `template-artifact-delivery`: "Artifact route": files of a killed version answer `404`.
- `template-catalog`: "Seeded launch templates": the seed keeps an admin's retire or kill.
- `audit-log`: "Audit records": the three template actions.

## Non-goals

- Publishing a new template version, or releasing a `draft` one, from the admin area. Releases stay
  committed code plus `db:seed`.
- Moving gifts from a killed version to another version. A gift pins its exact version for years.
- Counting the gifts pinned to a version on the admin page (it needs an index on the bound version
  that no query has needed so far).
- Owner notifications about a killed template (needs `email.send`, Sprint 5).
- Purging copies of a killed artifact already held by browsers. No page references them once
  killed.

## Impact

- **Code.**
  - `modules/templates` gains the version-control service, its Mongo adapter and the kill lookup.
  - `composition/viewer.ts`, `composition/gifts.ts` and `composition/templates.ts` resolve
    artifacts through the kill lookup. `resolveArtifact` and `publishing.artifacts.resolve` become
    asynchronous.
  - The artifact route, the Studio page, the admin page and `POST /api/admin/template-versions` are
    affected.
- **Data.** Two optional fields on `templateVersions`: `adminRetiredAt` and `killedAt`, plus
  `killReason`. The validator allows additional properties, so there is no schema version change
  and no migration.
- **Invariants.**
  - **Immutable template releases:** kept. No manifest or artifact changes; a kill only stops
    serving one.
  - **Pinned exact version:** kept. Gifts never fall back to another version (the existing "Artifact
    resolution" rule).
  - **Authorization:** opaque `404` for non-admins on the page and the route, as in `admin-access`.
  - **CSP and caching:** `/admin/templates` uses the admin nonce CSP. The new route is a no-store
    admin API. The artifact route keeps its immutable caching for served files; its `404` is not
    cached.
  - **Logging:** no gift text is read or logged; audit metadata holds only the reason code.
