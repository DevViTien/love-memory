## ADDED Requirements

### Requirement: Runtime outcome notification

The gift viewer SHALL tell its host page, at most once per mount, how its runtime settled:

- `ready`, when the template first answers `READY`;
- `fallback`, when it switches to the static rendering for any reason of "Static fallback keeps the
  content", including a payload whose `artifactUrl` is `null`.

The notification is independent of the person's gesture: with a ready source it arrives behind the
envelope. It MUST NOT carry gift content, and it MUST NOT change the playback state or the
lifecycle notifications. With a deferred source it arrives only after the load succeeded. An
unmounted gift viewer MUST NOT send it, including a `NO_ARTIFACT` fallback detected while it was
mounting (a development double mount reports it once).

#### Scenario: Ready behind the envelope

- **WHEN** a gift viewer with a ready source mounts and the template answers `READY` three times
  during the handshake
- **THEN** the host page is notified `ready` exactly once, and the envelope is still shown

#### Scenario: Handshake timeout

- **WHEN** the iframe loads but no `READY` arrives after 20 `INIT` attempts
- **THEN** the host page is notified `fallback` once, and no `ready` follows

#### Scenario: No artifact

- **WHEN** a gift viewer mounts with a payload whose `artifactUrl` is `null`
- **THEN** the host page is notified `fallback` once, after the mount

#### Scenario: Unmounted before settling

- **WHEN** the gift viewer is unmounted before `READY` arrives
- **THEN** no runtime outcome is notified for that mount
