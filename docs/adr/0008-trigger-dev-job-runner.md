# ADR-0008: Use Trigger.dev as the managed job runner

- Status: accepted for implementation after the media domain exists
- Date: 2026-09-15

## Context

Image processing, email, scheduled reveal, cleanup and payment reconciliation must survive request
completion and support retries. Running these tasks with `setTimeout`, an unawaited Promise or cron
inside a Vercel web process is not durable.

## Decision

Use Trigger.dev Cloud for the MVP job runner. Application code publishes versioned job commands
through a small port; job payloads contain identifiers rather than private gift content. Every job
has an idempotency key, retry/backoff, timeout and a recoverable failure path.

The Sprint 0 Sharp route is deliberately a bounded spike. Production media processing moves to a
job in Sprint 2 and reuses `@love-memory/media`.

## Consequences

- The outbox remains the durable handoff for business-critical side effects.
- Provider dashboards are useful operationally but are not the domain source of truth.
- Job schema changes remain backward compatible while old jobs can still execute.

## Revisit when

- Workload cost or data-location requirements justify a self-hosted BullMQ/Redis worker.
- A different managed runner provides a materially simpler recovery model.
