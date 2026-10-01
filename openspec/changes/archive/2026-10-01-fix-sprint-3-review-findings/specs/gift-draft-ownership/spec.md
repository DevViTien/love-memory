## MODIFIED Requirements

### Requirement: Claim an anonymous draft after sign-in

The system SHALL let a signed-in creator claim an anonymous draft through `POST /api/gifts/{publicId}/claim` with the strict JSON body `{}`. Without a session the system SHALL respond `401` with code `UNAUTHORIZED`. A claim SHALL succeed only when all of these are true: the request carries the draft's anonymous cookie, both credentials match, the draft still has no owner, and its status is `draft`. Otherwise the system SHALL respond `404` with code `NOT_FOUND`, including when the draft has already been claimed. A successful claim SHALL, in one atomic write, set the owner to the signed-in user, clear the anonymous draft ID and claim-token hash, and update `updatedAt` without changing `revision`. It SHALL then respond `200` with a DTO whose `ownerKind` is `user`.

The studio page SHALL claim an anonymous draft automatically when a signed-in viewer opens `/studio/{publicId}` and the request carries that draft's matching anonymous cookie, so that a creator who returns from the sign-in link does not need a second step. The automatic claim SHALL use the same conditions and the same atomic write as the claim endpoint, SHALL be idempotent, and SHALL happen before the page renders, which then shows the draft as owned (`ownerKind` `user`). When the automatic claim does not succeed, the page SHALL render the draft as it is and offer the claim action. For an anonymous draft opened without a session, the studio page SHALL offer a sign-in link to `/auth/sign-in?next=/studio/{publicId}`.

#### Scenario: Successful claim

- **WHEN** a signed-in creator with the matching anonymous cookie posts `{}` to `/api/gifts/{publicId}/claim`
- **THEN** the response is `200` with `data.gift.ownerKind` `user`, and the draft's revision is unchanged

#### Scenario: Claim without a session

- **WHEN** a request without a session posts to `/api/gifts/{publicId}/claim`
- **THEN** the response is `401` with code `UNAUTHORIZED`

#### Scenario: Claim with a wrong or missing claim token

- **WHEN** a signed-in creator posts a claim without the anonymous cookie, or with a claim token that does not match
- **THEN** the response is `404` with code `NOT_FOUND`, and ownership is unchanged

#### Scenario: Returning from the sign-in link in the same browser

- **WHEN** a creator who started an anonymous draft in this browser signs in through the magic link and lands on `/studio/{publicId}`
- **THEN** the draft is claimed before the page renders, the page shows it as owned by the account, and `Xuất bản` needs no separate claim action
- **AND** the draft's revision is unchanged

#### Scenario: Automatic claim lost to another account

- **WHEN** the draft was claimed by another account between the page's read and its automatic claim
- **THEN** ownership is unchanged by this request and the page does not show the draft as owned by the viewer

## ADDED Requirements

### Requirement: Studio not-found guidance

The not-found page of `/studio/{publicId}` SHALL be one page for every cause (unknown draft, no access, another owner, a status other than `draft` or `published`). It MUST NOT reveal whether the draft exists. It SHALL explain the most common cause after a sign-in in another browser, with the heading `Không mở được bản nháp này` and the text `Bản nháp tạo khi chưa đăng nhập chỉ mở được trên trình duyệt đã tạo ra nó. Hãy mở lại trình duyệt hoặc điện thoại bạn đã dùng để tạo quà, đăng nhập ở đó để lưu quà vào tài khoản.`, and SHALL link to `/templates`.

#### Scenario: Magic link opened in another browser

- **WHEN** a creator signs in through a magic link that opened in a browser without the draft's anonymous cookie and lands on `/studio/{publicId}`
- **THEN** the page shows `Không mở được bản nháp này` with the explanation, and no draft content

#### Scenario: Unknown draft

- **WHEN** anyone opens `/studio/{publicId}` for a draft that does not exist
- **THEN** the same page is shown as for a draft the requester cannot access
