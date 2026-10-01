# Spec Delta

## MODIFIED Requirements

### Requirement: Read a draft

The system SHALL return an authorized draft through `GET /api/gifts/{publicId}` with status `200` and the draft DTO. The system SHALL respond `404` with code `NOT_FOUND` in each of these cases: the `publicId` is not 16 to 64 characters from `[A-Za-z0-9_-]`, the requester presents no draft credentials, the requester is not authorized for the draft, or the gift is no longer in status `draft`. The studio editor page `/studio/{publicId}` SHALL load the draft through the same authorization rules and SHALL render the not-found page in the same cases, with one exception: for a gift in status `published` that the requester is authorized for, it SHALL render the published panel specified in `gift-publishing` ("Published gift in the Studio") instead of the editor. `GET /api/gifts/{publicId}` SHALL keep responding `404` for that gift.

#### Scenario: Owner reads a draft

- **WHEN** an authorized requester calls `GET /api/gifts/{publicId}` for an existing draft
- **THEN** the response is `200` with `data.gift` containing that draft

#### Scenario: Malformed public ID

- **WHEN** `GET /api/gifts/{publicId}` is called with a `publicId` shorter than 16 characters or containing unsupported characters
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Published gift in the draft API and the Studio

- **WHEN** the owner of a published gift calls `GET /api/gifts/{publicId}` and opens `/studio/{publicId}`
- **THEN** the API responds `404` with code `NOT_FOUND`, and the Studio shows the published panel instead of the not-found page
