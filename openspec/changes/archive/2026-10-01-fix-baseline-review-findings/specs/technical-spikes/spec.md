## MODIFIED Requirements

### Requirement: Spike enablement configuration

The system SHALL treat technical spikes as disabled unless `TECHNICAL_SPIKES_ENABLED` is exactly
`true`. `TECHNICAL_SPIKES_ENABLED` MUST be `true`, `false` or unset; any other value SHALL be
rejected as invalid configuration. `TECHNICAL_SPIKE_TOKEN` is optional, an empty value SHALL be
treated as unset, and a configured token MUST be 24 to 256 characters long. When spikes are enabled
the token MUST be configured; otherwise the configuration SHALL be rejected with
`TECHNICAL_SPIKE_TOKEN is required when technical spikes are enabled.` Regardless of these
variables, technical spikes SHALL be disabled whenever `VERCEL_ENV` is `production`, so the spike
pages and endpoints behave exactly as when they are disabled.

#### Scenario: Disabled by default

- **WHEN** neither `TECHNICAL_SPIKES_ENABLED` nor `TECHNICAL_SPIKE_TOKEN` is set
- **THEN** technical spikes are disabled

#### Scenario: Enabled without token is invalid

- **WHEN** `TECHNICAL_SPIKES_ENABLED` is `true` and `TECHNICAL_SPIKE_TOKEN` is unset
- **THEN** reading the spike configuration fails with a validation error

#### Scenario: Production deployment ignores the enable flag

- **WHEN** `VERCEL_ENV` is `production` and `TECHNICAL_SPIKES_ENABLED` is `true` with a valid token
- **THEN** technical spikes are disabled and `/studio/spikes` responds `404`
