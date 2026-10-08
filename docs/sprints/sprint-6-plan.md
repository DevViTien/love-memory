# Sprint 6 plan: admin, privacy, deletion and security

Date: 2026-10-08. Sprint goal and exit criteria: [plan.md §15](../../plan.md) (Gate M5). The
sprint follows the [sprint workflow runbook](../runbooks/sprint-workflow.md): one OpenSpec change at
a time, each one proposed, reviewed, applied, verified, archived and committed before the next one
starts.

## Starting point

- **Sprint 4** (plan.md §13) is mostly not built. There is no pause, resume or delete, no access
  policy other than `unlisted`, no QR and no dashboard.
- **Sprint 5** ([sprint-5-plan.md](./sprint-5-plan.md)) has delivered only its first change,
  `add-gift-plans-and-entitlements`, merged into `dev` on 2026-10-08. Emails, checkout and the
  payment webhook have not started.
- **Gates.** Gate M2 still waits for its manual checks, and Gates M3 and M4 are open.

## Product Owner decisions (2026-10-08)

| #   | Decision                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Sprint 6 starts before Sprints 4 and 5 are finished. The job outbox (Sprint 5 change 2, plan.md §14.4) moves to the front of Sprint 6, because deleting data has to run in background jobs. Emails, checkout and the webhook stay in Sprint 5.              |
| A2  | Admins sign in with a second factor from an authenticator app (TOTP, Better Auth `twoFactor`), with backup codes. It is required before any `/admin` page.                                                                                                  |
| A3  | Admin rights are granted and revoked only by operator commands (`pnpm admin:grant`, `pnpm admin:revoke`), which write to the audit log. No UI grants rights.                                                                                                |
| A4  | When an owner deletes a gift, its link dies at once. A background job removes photos, content, publications, revisions and analytics links within 24 hours. Only a tombstone (ids, times) and a minimal audit record are kept, for 1 year, with no content. |

## Changes, in dependency order

| #   | Change                           | Plan.md      | Outcome                                                                                                                                                                                              |
| --- | -------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `add-job-outbox-dispatcher`      | §14.4        | A generic job runtime (retry, dead-letter, operator commands, `jobs-drain` and `jobs-sweep`), readiness for stalled jobs, and `gift.assets.cleanup.v1` for detached photos.                          |
| 2   | `add-admin-access-and-audit`     | §15.1, §15.4 | The admin role from CLI grants, TOTP MFA, the `/admin` shell with search by id, the audit log, and the admin views of assets and gifts.                                                              |
| 3   | `add-template-kill-switch`       | §15.1        | Admins retire or kill a template version. Gifts on a killed version show their static rendering; the Studio refuses new drafts.                                                                      |
| 4   | `add-gift-pause-and-delete`      | §13.1, §15.3 | Owners pause, resume and delete gifts. `gift.delete.v1` revokes access, deletes objects and documents, anonymizes events, and keeps a tombstone. It reports the deletion status.                     |
| 5   | `add-abuse-reports-and-takedown` | §15.2        | A public report form on `/g` (rate limited), the admin review queue, takedown (admin pause), the audit trail and an emergency flow.                                                                  |
| 6   | `add-privacy-consent-and-export` | §15.3        | The privacy notice and consent, the upload-rights confirmation at publish (P4), retention labels, owner export, and the retention of superseded publications.                                        |
| 7   | `change-security-hardening`      | §15.4, §15.5 | HSTS and the remaining headers, rate-limit coverage (D1, D2/D18), a session and cookie review, a broken-access-control test pass, a credential-rotation runbook, and the backup and restore runbook. |

## Dependencies and how they are handled

- **Pause and delete (Sprint 4 §13.1).** Built here, in change 4, because Gate M5 requires them.
- **Owner notification email on takedown.** It needs `email.send` (Sprint 5). Until then the owner
  sees a notice in the Studio, and the email is added with Sprint 5's email change.
- **Admin order and payment view.** It needs orders (Sprint 5 changes 4–5). Change 2 builds the
  admin shell so that view can be added with those changes.
- **Automatic deletion after expiry.** It needs `gift.expire`, which waits for change 6's retention
  table.

## Debt absorbed

- **D1, D2 and D18** (rate limits on page renders, the limiter as a port): change 7.
- **D6** (load an asset by id and gift): change 4, which reads assets for deletion.
- **D12** (real-MongoDB integration tests): grows with each change's `db:verify-*` script.
- **Risk-register rows:**
  - detached assets in Blob storage: change 1;
  - share links that cannot be revoked: change 4;
  - free publishing on Production before takedown: change 5;
  - superseded publication text: change 6.
