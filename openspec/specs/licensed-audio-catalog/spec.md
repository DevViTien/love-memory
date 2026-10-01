# licensed-audio-catalog Specification

## Purpose

The licensed audio catalog is the source-controlled list of music tracks that creators may attach
to a gift through an `audio` template field. It records each track's license provenance, serves the
track files as immutable same-origin static assets, and exposes only safe track metadata to
browsers.

## Requirements

### Requirement: Track records

The system SHALL keep the licensed audio catalog as an ordered list of track records in source
control. The list MAY be empty. Each record MUST contain:

- `id`: a lowercase kebab-case identifier of 1 to 80 characters, unique within the catalog.
- `title`: 1 to 80 characters.
- `artist`: 1 to 80 characters.
- `durationSec`: an integer from 1 to 600.
- `status`: `active` or `withdrawn`.
- `license`: an object with `kind` (one of `purchased`, `royalty-free`, `commissioned` or
  `project-owned`), `reference` (1 to 200 characters naming the contract, invoice or license URL)
  and an optional `attribution` (at most 200 characters).
- `file`: an object with `fileName`, `mimeType` (`audio/mpeg` or `audio/mp4`), `bytes` (an integer
  from 1 to 8388608) and `sha256` (64 lowercase hexadecimal characters).

`file.fileName` MUST be `{id}.{first 16 characters of sha256}.{extension}`, where the extension is
`mp3` for `audio/mpeg` and `m4a` for `audio/mp4`. A catalog that violates any of these rules MUST
fail to load.

#### Scenario: Valid track

- **WHEN** the catalog holds a track `acoustic-morning` with `mimeType` `audio/mpeg`, a 64-character
  `sha256` beginning `3f9a0c1d2e4b5a67` and `fileName` `acoustic-morning.3f9a0c1d2e4b5a67.mp3`
- **THEN** the catalog loads and the track can be looked up by `acoustic-morning`

#### Scenario: Duplicate id or malformed record

- **WHEN** two tracks share an `id`, a track has no `license.reference`, or a track's `fileName`
  does not match its `id`, `sha256` and `mimeType`
- **THEN** loading the catalog fails

#### Scenario: Empty catalog

- **WHEN** the catalog contains no tracks
- **THEN** it loads, the list of selectable tracks is empty, and no lookup succeeds

### Requirement: Track identity is permanent

A track's `id`, `file` and `license` SHALL NOT change once the track has been released. A different
recording or file MUST be added as a new track with a new `id`. A track MUST NOT be removed from
the catalog. Instead its `status` becomes `withdrawn`, and looking it up by `id` SHALL still
return the track with that status, so that stored gift content keeps resolving to a known track.

#### Scenario: Withdrawn track still resolvable

- **WHEN** the track `acoustic-morning` has `status` `withdrawn` and is looked up by id
- **THEN** the lookup returns the track with `status` `withdrawn`

#### Scenario: Unknown id

- **WHEN** a lookup uses an id that no catalog record has
- **THEN** the lookup returns no track

### Requirement: Selectable tracks and browser DTO

The system SHALL expose to browsers only the `active` tracks, in catalog order, each as a DTO with
exactly `id`, `title`, `artist`, `durationSec` and `url`, where `url` is the same-origin path
`/audio-library/{fileName}`. The `license`, `sha256`, `bytes` and `status` values MUST NOT appear in
browser DTOs. Withdrawn tracks MUST NOT be offered for selection.

#### Scenario: Active tracks only

- **WHEN** the catalog holds `acoustic-morning` (`active`) followed by `old-piano` (`withdrawn`)
- **THEN** the selectable list contains only `acoustic-morning`, with `url`
  `/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3` and no `license` key

### Requirement: Static track delivery

The system SHALL serve every catalog track file at `GET /audio-library/{fileName}` from the
application origin, without authentication, with a `Content-Type` equal to the track's `mimeType`.
The response MUST include `Cache-Control: public, max-age=31536000, immutable` and
`X-Content-Type-Options: nosniff`. A request for a file name that is not in the catalog directory
SHALL respond `404`. Track files are catalog content, not user media: they MUST NOT be stored in
MongoDB or in the private media Blob store.

#### Scenario: Catalog file requested

- **WHEN** a browser requests `/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3`
- **THEN** the response is `200` with `Content-Type: audio/mpeg`,
  `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`

#### Scenario: Unknown file requested

- **WHEN** a browser requests `/audio-library/not-a-track.0000000000000000.mp3`
- **THEN** the response is `404`

### Requirement: Catalog file integrity gate

The system SHALL, in the test suite run by CI, verify that for every catalog track the file named
by `file.fileName` exists in the static `audio-library` directory, that its size equals
`file.bytes`, and that its SHA-256 digest equals `file.sha256`. The gate MUST also fail when the
directory contains a file that no catalog record references.

#### Scenario: Consistent catalog

- **WHEN** every catalog file exists with the recorded size and digest and the directory holds no
  other files
- **THEN** the gate passes

#### Scenario: Tampered, missing or orphaned file

- **WHEN** a track file's digest differs from `file.sha256`, a referenced file is missing, or an
  unreferenced file is present in the directory
- **THEN** the CI test run fails naming the file
