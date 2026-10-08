# Sprint 5 plan: payment, entitlement and background workflows

Date: 2026-10-08. Sprint goal and exit criteria: [plan.md §14](../../plan.md) (Gate M4). The
sprint follows the [sprint workflow runbook](../runbooks/sprint-workflow.md): one OpenSpec change at
a time, each one proposed, reviewed, applied, verified, archived and committed before the next one
starts.

## Starting point

Sprint 4 (plan.md §13) is mostly not built. Only its first change,
`change-gift-publication-revisions`, is archived. Access policies other than `unlisted`, QR,
templates 2–3, the dashboard, and pause, resume and delete do not exist, and Gate M3 is open. Gate
M2 also still waits for its manual checks ([sprint-3-review.md](./sprint-3-review.md) §4).

## Product Owner decisions (2026-10-08)

| #   | Decision                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Sprint 5 starts before the rest of Sprint 4. Anything that needs a Sprint 4 feature is out of scope until that feature exists (see below).                                                                                                                                                                                              |
| S2  | Two plans:<br>**Free**: at most 3 photos, a small watermark, a link that works for 14 days. Publishing on Free needs no payment in any environment.<br>**Standard**: 49.000đ per gift, every photo the template allows, no watermark, 1 year. Password and scheduled access are included once Sprint 4 specifies them.                  |
| S3  | A gift is paid for once. Later updates of a published gift are free.                                                                                                                                                                                                                                                                    |
| S4  | No payOS credentials yet. A fake billing provider serves local development and E2E. The payOS adapter is first party: `fetch`-based, with no SDK dependency, and its signing rules are pinned by test vectors from `@payos/node` 2.0.5. A real payOS smoke test on `stg` comes once credentials exist; Production stays off until then. |

The prices and limits are the hypotheses of idea.md §12.2. They live in a versioned catalog
(ADR-0011), so a later price test is a new plan version, not an edit.

## Changes, in dependency order

| #   | Change                            | Plan.md     | Outcome                                                                                                                                                                                                  |
| --- | --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `add-gift-plans-and-entitlements` | §14.1       | Plan catalog, the per-gift entitlement snapshot, expiry by server time, the Free watermark and the plan choice in the Studio. It replaces `INTERNAL_PUBLISH_ENABLED`.                                    |
| 2   | `add-job-outbox-dispatcher`       | §14.4       | Generic outbox job types, a dispatcher and sweep, dead-letter and manual retry, `asset.cleanup` (detached and superseded assets) and `gift.expire`.                                                      |
| 3   | `add-system-emails`               | §14.5       | An email port, the `email.send` job, and the "payment received", "gift published" and "processing failed" emails. Emails never carry private gift content.                                               |
| 4   | `add-payos-checkout`              | §14.2–§14.3 | Orders and their state machine, the `BillingProvider` port, the payOS adapter and the fake provider, checkout from the Studio, and the return and cancel pages that poll. It removes the internal grant. |
| 5   | `add-payment-webhook-fulfillment` | §14.2–§14.3 | The verified webhook, idempotent events, amount and currency checks, `payment.reconcile`, `publish.finalize`, and a support view of order and fulfillment status.                                        |

## Out of scope until Sprint 4 lands

- `schedule.notification` and the scheduled reminder email (they need scheduled access).
- Enforcing the plans' `passwordAccess` and `scheduledAccess` (they need those access policies).
- The owner delete confirmation email (it needs owner delete).
- Designed expired, paused or deleted pages for recipients (they need the Sprint 4 access states).

## Debt absorbed

- **D2/D18** (the generic rate limiter as a port) when the checkout and webhook routes need their
  own rate limits (change 4).
- **The `asset.cleanup` risk** for detached and superseded assets (risk register), in change 2.
- **The per-actor idempotency namespace** (second half of D5), in change 4, where checkout keys are
  introduced.
