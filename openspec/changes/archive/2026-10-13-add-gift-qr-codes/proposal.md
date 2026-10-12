# Add gift QR codes

## Why

After the product pivot of 2026-10-13 ([plan.md §1.1](../../../plan.md)), the output of the
product is the gift page and the QR code that opens it. Today the published panel only offers the
link. A creator who wants to print the gift on a card, slip it into a physical present or set it
as a phone wallpaper has to find a QR generator elsewhere, and may paste the private link into a
third-party site.

This is change 2 of [the template pivot plan](../../../docs/sprints/template-pivot-plan.md)
(decision T8). It brings forward the QR part of Sprint 4 §13.3 (QR PNG, QR SVG, download).

## What Changes

- **QR section.** The Studio's published panel (`Đã xuất bản`) gains a `Mã QR` section. It shows
  the absolute share URL, the same one as `Đường dẫn món quà`, as a QR code at error correction
  level H.
- **Three styles**, chosen with a radio group (`Kiểu mã QR`):
  - `Cơ bản`: the code on white with its quiet zone, 1024 × 1024;
  - `Khung trái tim`: a rose heart around a white square that holds the code, 1024 × 1024;
  - `Hình nền điện thoại`: a 1080 × 2340 portrait image with a soft gradient, the line
    `Quét để mở món quà` and the code horizontally centred below it.

  In every style the modules stay dark on white, square and unobstructed. The decoration only
  surrounds the code.

- **Downloads.** `Tải PNG` and `Tải SVG` save the selected style. The PNG is drawn from the SVG on
  a canvas in the browser, at the style's full size. File names depend only on the style
  (`qua-tang-qr.png`, `qua-tang-qr-trai-tim.svg`, …), never on the share id or the gift's text.
- **Mobile saving.** The preview is the style's PNG, and a hint under it says to long-press the
  image to save it. That works in iOS in-app browsers, which ignore downloads. A browser without
  download support gets a message instead of a navigation away from the Studio.
- **Browser only.** The QR matrix is computed in the browser with `qrcode`. The SVG builders are
  pure functions, so they are unit-tested and decoded back to the URL in tests. No route, request,
  storage or analytics event is added.

## Capabilities

### New Capabilities

- `gift-qr-codes`: the QR code of the share URL, its styles and its downloads.

### Modified Capabilities

- `gift-publishing`: "Published gift in the Studio" lists the `Mã QR` section.

## Non-goals

- The Web Share API, social and bot preview classification, and a print test at target sizes
  (the rest of plan.md §13.3).
- A QR on the recipient's page or in system emails.
- Custom colours, logos or the gift's photos inside the code.
- A server-rendered QR endpoint, or QR images stored anywhere.
- Short links. The code encodes the existing share URL.

## Impact

- **Code:** `apps/web/src/modules/gifts/presentation/studio/`:
  - `gift-qr-code.ts`, the pure matrix and SVG builders;
  - `gift-qr-download.ts`, the PNG rendering and `blob:` downloads;
  - `gift-qr-section.tsx`, the section, used by `published-panel.tsx`.
- **Dependencies:**
  - `qrcode` (production, `apps/web`) and `@types/qrcode`;
  - `jsqr` and `sharp` (root dev dependencies) for the decode round trips of the unit and E2E
    tests. `sharp` was already in the catalog.
- **CSP:** none. The Studio's nonce policy already allows `img-src data: blob:` for the preview and the
  canvas source. A download through a `blob:` link is not governed by CSP.
- **Invariants:**
  - _Never log gift text, access passwords, magic-link tokens or signed URLs._ Nothing is logged
    or sent. The share URL stays in the browser, and file names carry no identifier.
  - _Protected gift payloads never enter public caches; private-content routes use nonce CSP._
    Unchanged. The section renders inside the existing nonce-CSP Studio page and needs no new
    directive.
  - _Recipients need no account._ Unchanged. The code opens the same public `/g/{shareId}` link.
