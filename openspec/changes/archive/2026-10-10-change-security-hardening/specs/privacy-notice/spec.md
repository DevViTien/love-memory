# Spec Delta

## MODIFIED Requirements

### Requirement: Privacy notice page

The system SHALL serve `/privacy` as a static public page titled `Chính sách quyền riêng tư`. It
SHALL state, in Vietnamese:

- **What is stored:** the account email; gift drafts and published gifts (text, dates, the chosen
  music and photos); reports; operational logs without gift content.
- **Who can see a gift:** the creator, anyone with the share link while the gift is published, and
  the operations team only to review a report.
- **The retention table:**
  - drafts are kept until the owner deletes them;
  - a published gift opens for the plan's period (14 days on Free, 1 year on Standard) and is then
    kept for the owner until deleted;
  - the version shown before an update is deleted within minutes of the update;
  - original photos are not kept; only processed photos without location data are;
  - a deleted gift's link stops at once, and its content and photos are erased within 24 hours,
    keeping a record of ids and times for 1 year; database backups that still hold it expire within
    7 days (`backup-and-restore` runbook);
  - reports and the admin audit log are kept 1 year;
  - sign-in sessions last 30 days;
  - anonymous statistics, when enabled, are kept 180 days without any account link.
- **Cookies and storage:** the session cookie, the anonymous draft cookie (30 days), and no
  advertising or third-party tracking.
- **The owner's controls:** pause, delete and export from the Studio, and the report form on a
  gift.

The page SHALL use the static-compatible CSP of public routes (`content-security-policy`).

#### Scenario: Notice reachable without an account

- **WHEN** a signed-out browser opens `/privacy`
- **THEN** the page shows `Chính sách quyền riêng tư`, the retention table, and the cookie section
