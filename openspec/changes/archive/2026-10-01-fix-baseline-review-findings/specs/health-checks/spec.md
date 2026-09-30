## MODIFIED Requirements

### Requirement: Safe readiness failure response

The system SHALL respond to any failed readiness check with HTTP `503` and exactly the JSON body
`{ "error": { "code": "SERVICE_UNAVAILABLE", "message": "Service dependencies are not ready.", "requestId": <id> } }`.
The response MUST NOT reveal which dependency failed, error messages, stack traces, connection
strings, tokens or other configuration values.

#### Scenario: Failure body is generic

- **WHEN** readiness fails because of an invalid `MONGODB_URI`
- **THEN** the body message is `Service dependencies are not ready.` with code `SERVICE_UNAVAILABLE`
- **AND** the body contains no part of the configured URI or the underlying error message
