# Spec Delta

## MODIFIED Requirements

### Requirement: Takedown

A takedown SHALL pause a gift on behalf of the operations team. The gift becomes `paused` (if it
was `published`), and holds a `takedown` record with:

- `at`;
- `by`: `admin` or `system`;
- `reason` (a report category).

While it holds a takedown:

- its share link SHALL be not-found;
- the owner SHALL NOT resume it (`gift-lifecycle`);
- the owner MAY still delete it.

Lifting a takedown (a restore) SHALL remove the record. The gift SHALL become `published` again
when its `expiresAt` has not passed, and otherwise stay `paused`. A gift being deleted SHALL NOT be
taken down or restored. Every takedown SHALL also enqueue, in its transaction, one
`email.send.v1` job of kind `gift_taken_down` (`system-emails`), with the deduplication key
`email.send.v1:gift_taken_down:{giftId}:{takedownTime}`.

#### Scenario: Owner cannot resume a taken-down gift

- **WHEN** the owner of a taken-down gift sends `POST /api/gifts/{publicId}/resume`
- **THEN** the response is `409` with `details.reason` `GIFT_TAKEN_DOWN`, and the gift stays paused

#### Scenario: Owner emailed on takedown

- **WHEN** an admin takes a gift down
- **THEN** the owner receives `Món quà của bạn đã bị tạm khoá`, without any report detail
