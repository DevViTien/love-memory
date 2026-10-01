## MODIFIED Requirements

### Requirement: Analytics rate limits

`POST /api/events` SHALL charge each request that passed the body checks to two counters, in this
order, and it SHALL reject the request when either counter is over its limit. The per-network
`analytics-event-ip` counter SHALL be charged only when the per-session `analytics-event` counter
allowed the request, so one tab that floods events does not use up the budget of the other tabs on
its network:

| Scope                | Subject                            | Limit                         |
| -------------------- | ---------------------------------- | ----------------------------- |
| `analytics-event`    | network subject + body `sessionId` | 60 requests per 600 seconds   |
| `analytics-event-ip` | network subject                    | 1200 requests per 600 seconds |

The network subject SHALL be derived exactly as for the public read rate limit of
`public-gift-viewer`:

- the first value of the trusted `x-vercel-forwarded-for` header, when it is a valid IP address of
  at most 64 characters;
- an IPv6 address is reduced to its `/64` prefix;
- otherwise the shared `unidentified` subject. Its `analytics-event-ip` counter allows five times
  that scope's limit, because it is shared by every unidentifiable client. Its per-session
  `analytics-event` counter keeps the normal limit, because a session belongs to one tab.

The session and the anonymous draft cookie MUST NOT be used as the subject. Counters SHALL use the
same storage, atomic windows and keyed subject hashing as the mutation rate limits, so neither the
address nor the session id is stored in plaintext. A request over a limit SHALL be answered `429`
with code `RATE_LIMITED`, `error.details.retryAfterSeconds` and a matching `Retry-After` header,
and nothing SHALL be stored.

#### Scenario: One tab floods events

- **WHEN** one client behind `x-vercel-forwarded-for: 203.0.113.10` sends 61 valid events with the
  same `sessionId` within one 600-second window
- **THEN** the 61st response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and
  it is not stored

#### Scenario: Rotating session ids from one address

- **WHEN** one address sends 1201 valid events, each with a new `sessionId`, within one 600-second
  window
- **THEN** the 1201st response is `429` with code `RATE_LIMITED`

#### Scenario: Unidentified clients

- **WHEN** requests carry no trusted forwarding header
- **THEN** they share one `analytics-event-ip` counter that allows 6000 requests per 600-second
  window, while each `sessionId` among them is still limited to 60

#### Scenario: A rejected session does not charge the network

- **WHEN** a request is rejected because its `sessionId` already sent 60 events in the window
- **THEN** the `analytics-event-ip` counter of its network subject is not incremented

#### Scenario: Invalid bodies are not charged

- **WHEN** a client sends 100 requests whose bodies fail the schema
- **THEN** each response is `400`, and neither counter for that subject is charged
