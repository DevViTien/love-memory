## REMOVED Requirements

### Requirement: Invalid-link explanation on the sign-in page

**Reason**: The alert only matched the synthetic `invalid-link` value, which the provider overwrites
with its own error code, so real failed verifications showed no explanation.

**Migration**: Replaced by "Sign-in error explanation", which covers every verification error.

## ADDED Requirements

### Requirement: Sign-in error explanation

A failed magic-link verification SHALL redirect to `/auth/sign-in` with an `error` query parameter.
When a signed-out visitor opens `/auth/sign-in` with a non-empty `error` value, the sign-in page
SHALL show an alert and SHALL keep the sign-in form available. For `invalid-link` and
`INVALID_TOKEN` the alert SHALL say that the sign-in link is invalid, expired, or already used and
that a new link should be requested. For any other `error` value the alert SHALL say that sign-in
could not be completed and ask the visitor to try again. The page MUST NOT display the raw `error`
or `error_description` values, and SHALL NOT show either alert to a signed-in visitor.

#### Scenario: Invalid-link error shown to a signed-out visitor

- **WHEN** a signed-out visitor opens `/auth/sign-in?error=invalid-link`
- **THEN** an alert explains that the link is invalid, expired, or already used
- **AND** the email form is shown so a new link can be requested

#### Scenario: Reused link from the provider is explained

- **WHEN** a visitor opens a magic link whose token was already consumed
- **THEN** the browser lands on `/auth/sign-in` with `error` set to `INVALID_TOKEN`
- **AND** the invalid, expired, or already-used alert is shown with the email form

#### Scenario: Unknown error value shows a generic alert

- **WHEN** a signed-out visitor opens `/auth/sign-in` with an `error` value such as `failed_to_create_session`
- **THEN** a generic sign-in failure alert is shown without echoing the error value
