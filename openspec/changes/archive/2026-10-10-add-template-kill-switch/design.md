# Design

## Context

For the why and the scope, see proposal.md. The relevant code at `19b3c58`:

- **Collections.**
  - `templateVersions` holds one document per release: `_id` = `<templateId>@<version>`, plus
    `status` (`draft`, `published` or `retired`), `manifest` and `contentHash`.
  - `templates` holds `currentVersion`.
  - Both validators allow additional properties.
- **Seed.** `db:seed` (`template-release-seed.ts`) upserts versions with `$set: { status }`, so
  every re-run resets the status to the seeded one.
- **Resolution.**
  - **Creation.** `findCreatableManifest` (`published` only) gates new drafts.
  - **Editing.** `findEditableManifest` (`published` or `retired`) gates editing, preview, `/g` and
    publish.
  - **Artifacts.** A template artifact comes from the in-code registry, through
    `getTemplateArtifact`. That function is wired synchronously into:
    - `composition/viewer.ts` (`resolveArtifact`, used by `buildViewerPayload`);
    - `composition/gifts.ts` (`publishing.artifacts.resolve`, used by create and publish);
    - `composition/templates.ts` (`isTemplateVersionAvailable`, used by the catalog and the Studio
      page);
    - the artifact route.
- **Static rendering.** A `null` `artifactUrl` already gives the static rendering in the viewer and
  the notice in the preview. A missing artifact already refuses publishing with `409`
  `TEMPLATE_VERSION_UNPUBLISHABLE`.
- **Admin pattern** (`add-admin-access-and-audit`):
  - `requireAdminPage` and `requireAdminRoute`;
  - `auditService` and `insertAuditRecord(database, record, session)`;
  - the admin layout's navigation.

Governing ADRs: ADR-0004 (template artifact isolation), ADR-0001 (adapters wired in composition),
ADR-0005 (route-specific CSP).

## Goals / Non-Goals

**Goals:**

- One switch that every artifact consumer obeys, enforced on the server.
- No change to immutable releases or pinned versions.
- The switch takes effect from the next request, with no deploy, cache purge or migration.

**Non-Goals:** see proposal.md.

## Decisions

### 1. A kill is "no artifact", decided in one function

`modules/templates/application/template-version-controls.ts` defines the port
`TemplateVersionStateRepository`:

- `findState(templateId, version)`;
- `listVersions()`;
- the three transitions.

`composition/templates.ts` exports **`resolveTemplateArtifact(id, version)`**. It returns the
registry artifact unless the registry has none, or the version is killed (one `findOne` by `_id`
with a projection of `killedAt`).

**Wiring.** Every consumer goes through `resolveTemplateArtifact`:

- `composition/viewer.ts` `resolveArtifact`;
- `composition/gifts.ts` `publishing.artifacts.resolve`;
- the Studio page's `publishable`;
- the artifact route.

The two ports `resolveArtifact` and `publishing.artifacts.resolve` become asynchronous: their types
return a `Promise`, and `buildViewerPayload`, `createDraft` and `publish` await them. The catalog's
`isTemplateVersionAvailable` stays synchronous: a killed version is `retired`, so the catalog never
lists it anyway.

**Why at resolution and not in the status.** A new status value such as `killed` would make
`findEditableManifest` miss the version. Drafts and published gifts would then answer `404`, and
the Studio page would throw. The kill must keep the gift readable and only drop the template.

**Cost.** One indexed `_id` read per artifact resolution. Viewer, preview and publish already read
several documents per request. The artifact route answers `404` for killed versions, uncached.
Served files keep `immutable` caching, because their URL is content-addressed and only pages that
resolved an artifact reference it.

### 2. Data shape and the seed

`templateVersions` gains three optional fields; the validator is unchanged:

- `adminRetiredAt` (date): set by `retire`, and by `kill` when the version was not yet retired;
- `killedAt` (date or `null`);
- `killReason` (`broken`, `security`, `legal`, `other`, or `null`).

The schema version therefore stays `13` (`database-schema-management` needs no change).

**The seed.** `upsertTemplateVersion` keeps its upsert, now without `status`. It then sets `status`
with a second `updateOne({ _id, adminRetiredAt: { $exists: false } }, { $set: { status } })`, and on
insert also sets `status`. An admin's retire or kill therefore survives `db:seed`, while the seed
can still retire versions itself.

The `templates.status` written by the seed is unchanged. The catalog joins the current version with
`status: "published"`, so retiring the current version hides the template from the catalog; the
page says so in the confirmation text.

### 3. Transitions and audit, in one transaction

`mongo-template-version-state.ts` implements each transition as one conditional `updateOne`, with
`insertAuditRecord` inside `client.withSession(... withTransaction ...)`:

| Action    | Filter                                                     | Update                                                                                  |
| --------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `retire`  | `_id`, `status: "published"`                               | `status: "retired"`, `adminRetiredAt`, `updatedAt`                                      |
| `kill`    | `_id`, `status ∈ {published, retired}`, `killedAt` not set | `status: "retired"`, `killedAt`, `killReason`, `adminRetiredAt` if missing, `updatedAt` |
| `restore` | `_id`, `killedAt` set                                      | `killedAt: null`, `killReason: null`, `updatedAt`                                       |

**When the filter matches nothing,** the service reads the version:

- missing: `NOT_FOUND`;
- `draft`: `VERSION_NOT_RELEASED`;
- otherwise: an unchanged no-op.

Nothing is recorded in those cases. `adminRetiredAt` for `kill` uses `$ifNull` in a pipeline
update.

**The audit record** has:

- actor `{ kind: "admin", id }`;
- target `{ kind: "template-version", id: "<templateId>@<version>" }`;
- metadata `{ reason }` for `kill` only.

`AuditActionSchema` gains `admin.template.retired`, `admin.template.killed` and
`admin.template.restored`. The audit collection's validator only requires a non-empty `action`.

### 4. Route and page

**`POST /api/admin/template-versions`** follows `admin-mfa-route-handlers.ts`:

1. `requireAdminRoute({ allowMfa: false })`;
2. `validateJsonMutationRequest`;
3. a strict Zod body of at most 1 KiB. `reason` is required for `kill` and refused for the other
   actions; a refinement reports it on `fieldErrors.reason`.
4. The service call, mapped to `200`, `404` or `409`.

There is no rate limit beyond the admin guard: the route is reachable only after a step-up, and
every change is audited.

**`/admin/templates`** (`app/admin/templates/page.tsx`) is a server page behind
`requireAdminPage`. It renders `AdminTemplateVersionsTable` with one client component per row
(`TemplateVersionActions`). Each action:

1. asks for confirmation with `window.confirm`;
2. posts JSON;
3. calls `router.refresh()`.

The kill action also has a `<select>` for the reason. The layout's navigation gains `Mẫu quà`. CSP,
headers and `connection()` come from the existing `/admin` rules.

## Risks / Trade-offs

- **A copy of the artifact already in a browser cache.** It stays there until evicted. No page
  references it after a kill, because the viewer receives no URL. Acceptable: the kill exists to
  stop gifts from running the template, and they no longer do.
- **A kill at the wrong time** degrades every gift on that version to the static rendering. This is
  mitigated by the confirmation, the audit record and `restore`.
- **Async ports.** Every caller and test of `resolveArtifact` and `artifacts.resolve` changes. The
  change is mechanical and covered by the existing tests, updated to await.

## Migration Plan

No migration. Deploy, then run the smoke test on the tier:

1. kill an unused version (for example `our-timeline@1.0.0`, which has no artifact);
2. check the audit page;
3. restore it.

Rollback: the previous build ignores `killedAt` and `adminRetiredAt`. A killed version would serve
its artifact again; an admin-retired one stays `retired` until the old seed runs.
