# Spec Delta

## MODIFIED Requirements

### Requirement: Audit records

The system SHALL record each audited event as one document in `auditLog`, holding exactly:

- `_id`, a UUID;
- `at`, the server time;
- `actor`: `{ kind: "admin", id: <user id> }`, `{ kind: "operator", id: <operator name> }` or
  `{ kind: "system", id: <job type> }`;
- `action`, one of the actions listed below;
- `target`: `{ kind, id }` (for example `{ kind: "gift", id: <internal id> }` or
  `{ kind: "user", id: <user id> }`), or `null`;
- `requestId`, or `null` outside a request;
- `metadata`, an object of at most 10 keys whose values are booleans, numbers, or strings of at most
  100 characters, holding identifiers and codes only;
- `expiresAt`, 365 days after `at`.

The actions are `admin.role.granted`, `admin.role.revoked`, `admin.mfa.enrolled`, `admin.mfa.reset`,
`admin.mfa.verified`, `admin.mfa.failed`, `admin.gift.looked_up`, `admin.template.retired`,
`admin.template.killed` and `admin.template.restored`. Later capabilities add their own actions to
this list.

**Contents.** A record MUST NOT contain gift content, captions, passwords, TOTP or backup codes,
tokens, share ids, signed URLs or email addresses. No API or command SHALL update or delete a record;
records disappear only through the expiry index after `expiresAt`. An audited event SHALL be recorded
when it happens, and a failure to record it SHALL fail the event's request or command.

**Who may record.** Only the system writes records. Any request or command that performs an audited
event writes them; no endpoint accepts a record from a client.

#### Scenario: Record without content

- **WHEN** an admin looks up a gift whose receiver name is `Minh Thư`
- **THEN** the audit record holds the actor, `admin.gift.looked_up`, the gift's internal id and
  `{ matched: true }`, and no `Minh Thư`, share id or email

#### Scenario: Records are kept for one year

- **WHEN** an audit record is written at `2026-10-09T10:00:00Z`
- **THEN** its `expiresAt` is `2027-10-09T10:00:00Z`

#### Scenario: Recording failure fails the action

- **WHEN** the audit write of `admin:grant` fails
- **THEN** the command exits with a non-zero status, and the role is not left changed without a
  record

#### Scenario: Template action recorded

- **WHEN** an admin kills `memory-box` `1.1.0` with the reason `broken`
- **THEN** a record holds `admin.template.killed`, the admin as actor, the target
  `{ kind: "template-version", id: "memory-box@1.1.0" }` and the metadata `{ reason: "broken" }`
