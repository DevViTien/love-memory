## ADDED Requirements

### Requirement: Media persistence verification

The system SHALL provide `db:verify-media`, which exercises the media repositories against the
configured database without touching object storage, and fails with a non-zero exit status unless
all of the following hold: concurrent upload reservations for one field never exceed its limit and
never share a gift or field slot; a reservation beyond the limit is refused; completing an upload
moves the asset to `uploaded` and inserts exactly one `media.process.v1` outbox job; the worker
claim moves the asset to `processing`; a transient failure schedules a retry and a requeue makes the
job available again; a stale exhausted lease fails the asset terminally; and an expired `initiated`
asset is claimed for cleanup. It SHALL delete every asset and outbox document it created whether or
not verification succeeds, and print `Media persistence verification completed successfully.` on
success. CI SHALL run it against a MongoDB replica set that uses the same Stable API settings as the
application.

#### Scenario: Stable API strict mode is exercised

- **WHEN** `db:verify-media` runs against a MongoDB deployment with Stable API strict mode enabled
- **THEN** every repository operation it calls succeeds, or the command fails

#### Scenario: Verification leaves no residue

- **WHEN** `db:verify-media` completes, successfully or not
- **THEN** no `assets` or `jobOutbox` documents created by the verification remain
