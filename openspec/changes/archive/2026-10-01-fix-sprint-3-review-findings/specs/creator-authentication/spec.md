## MODIFIED Requirements

### Requirement: Generic sign-in responses

The system MUST NOT reveal whether an email address already has an account. After a successful sign-in request, the sign-in form SHALL show the same confirmation for every address, saying that a single-use link was sent if the address is valid and that it expires after 10 minutes. The confirmation SHALL also say `Hãy mở liên kết trên cùng trình duyệt và thiết bị này để tiếp tục bản nháp của bạn.`, because a draft started without an account is held by the browser that created it (`gift-draft-ownership`). If the request fails because of a provider error or a network error, the form SHALL show a generic retry message and SHALL become usable again.

#### Scenario: Confirmation does not depend on account existence

- **WHEN** a sign-in request for any well-formed email address succeeds
- **THEN** the form is replaced by the same "check your inbox" confirmation, whether or not the address belongs to an existing user
- **AND** the confirmation asks the creator to open the link in this same browser and device

#### Scenario: Delivery or transport failure is recoverable

- **WHEN** the sign-in request returns an error or the network call throws
- **THEN** a generic "cannot send email right now, try again" message is shown
- **AND** the submit button is enabled again
