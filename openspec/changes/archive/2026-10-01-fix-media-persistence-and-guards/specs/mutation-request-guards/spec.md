## MODIFIED Requirements

### Requirement: Rate-limit subjects and key hashing

The system SHALL choose one primary rate-limit subject per request, in this order:

1. The signed-in user ID (`user:` subject).
2. Otherwise, the anonymous draft ID from a valid `love_memory_anonymous_draft` cookie (`anonymous:` subject).
3. Otherwise, the client IP from the first value of the trusted `x-vercel-forwarded-for` header, when it is a valid IP address of at most 64 characters (`ip:` subject).
4. Otherwise, the single shared `unidentified` subject.

Because an anonymous cookie is only checked for shape, a request whose primary subject is `anonymous:` SHALL also be charged to a network guard subject: `network:ip:<address>` from the trusted header when present, otherwise `network:unidentified`. Network guard subjects SHALL allow five times the scope's per-subject limit, and a request SHALL be rejected when any subject it is charged to is over its limit. The untrusted `x-forwarded-for` header MUST NOT be used as a subject. All requests that fall back to the `unidentified` subject SHALL share one counter per scope whose limit is five times that scope's per-subject limit, so unidentifiable traffic is bounded rather than unlimited. Subjects SHALL be stored only as keyed HMAC-SHA-256 hashes computed with the server auth secret, never in plaintext.

#### Scenario: Trusted forwarding header used for anonymous first create

- **WHEN** a request with no session and no anonymous cookie carries `x-vercel-forwarded-for: 203.0.113.10, 10.0.0.1` and `x-forwarded-for: 198.51.100.8`
- **THEN** the rate-limit subject is `ip:203.0.113.10`

#### Scenario: Only the untrusted header present

- **WHEN** a request with no session and no anonymous cookie carries only `x-forwarded-for`
- **THEN** the rate-limit subject is `unidentified`
- **AND** the request counts against the shared `unidentified` counter, which allows 50 `POST /api/gifts` requests per 600-second window

#### Scenario: Account takes precedence

- **WHEN** a signed-in creator also presents an anonymous draft cookie
- **THEN** the rate-limit subject is `user:<userId>` and no network guard is charged

#### Scenario: Forged anonymous cookies cannot reset the limit

- **WHEN** one client behind `x-vercel-forwarded-for: 203.0.113.10` sends 51 `POST /api/gifts` requests within 600 seconds, each with a different well-formed but made-up anonymous cookie
- **THEN** the 51st request is rejected with `429` because the `network:ip:203.0.113.10` guard allows 50
