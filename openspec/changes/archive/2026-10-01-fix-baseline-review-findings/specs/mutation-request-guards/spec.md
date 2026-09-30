## MODIFIED Requirements

### Requirement: Rate-limit subjects and key hashing

The system SHALL choose one rate-limit subject per request, in this order:

1. The signed-in user ID (`user:` subject).
2. Otherwise, the anonymous draft ID from a valid `love_memory_anonymous_draft` cookie (`anonymous:` subject).
3. Otherwise, the client IP from the first value of the trusted `x-vercel-forwarded-for` header, when it is a valid IP address of at most 64 characters (`ip:` subject).
4. Otherwise, the single shared `unidentified` subject.

The untrusted `x-forwarded-for` header MUST NOT be used as a subject. All requests that fall back to the `unidentified` subject SHALL share one counter per scope whose limit is five times that scope's per-subject limit, so unidentifiable traffic is bounded rather than unlimited. Subjects SHALL be stored only as keyed HMAC-SHA-256 hashes computed with the server auth secret, never in plaintext.

#### Scenario: Trusted forwarding header used for anonymous first create

- **WHEN** a request with no session and no anonymous cookie carries `x-vercel-forwarded-for: 203.0.113.10, 10.0.0.1` and `x-forwarded-for: 198.51.100.8`
- **THEN** the rate-limit subject is `ip:203.0.113.10`

#### Scenario: Only the untrusted header present

- **WHEN** a request with no session and no anonymous cookie carries only `x-forwarded-for`
- **THEN** the rate-limit subject is `unidentified`
- **AND** the request counts against the shared `unidentified` counter, which allows 50 `POST /api/gifts` requests per 600-second window

#### Scenario: Account takes precedence

- **WHEN** a signed-in creator also presents an anonymous draft cookie
- **THEN** the rate-limit subject is `user:<userId>`
