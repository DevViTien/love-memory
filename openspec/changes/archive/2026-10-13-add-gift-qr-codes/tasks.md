# Tasks: add-gift-qr-codes

## 1. Dependencies

- [x] 1.1 `qrcode` and `@types/qrcode` are in the pnpm catalog and `apps/web`, and `jsqr` and
      `sharp` are root dev dependencies for the decode round trips; `pnpm audit` reports nothing
      new.

## 2. QR builders

- [x] 2.1 `gift-qr-code.ts` builds the level H matrix, the run-length module path, the `plain`,
      `heart` and `wallpaper` SVGs at their PNG sizes, the file names and the data URL. Unit tests
      check well-formed SVG, sizes and `viewBox`, the painted module count against the matrix, a
      quiet zone of at least 4 modules (corners included) in every style for a production and a
      version 8 preview URL, 10 px heart modules for version 6, the absence of external
      references and of the URL, and the file names.
- [x] 2.2 `gift-qr-code.decode.test.ts` rasterizes each style with `sharp` and decodes it with
      `jsqr` back to the exact share URL, for a production, a local and a version 8 preview URL,
      and decodes the heart scaled down to 300 px.
- [x] 2.3 `gift-qr-download.ts` draws the PNG from the SVG on a canvas that it releases
      afterwards, and saves blobs through a temporary `blob:` link revoked later, only when the
      browser supports `download`. Tests cover the size, the PNG type, the canvas release, a
      missing context, a failed encoding, a failed decode, the link and its `_blank` target, and
      the unsupported path.

## 3. Studio

- [x] 3.1 `gift-qr-section.tsx` adds the `Mã QR` section. It holds the `Kiểu mã QR` radio group,
      whose selected option has a check, a bold label and a `rose-600` border. Below it are the
      PNG preview as a `data:` URL (SVG until it is ready), its Vietnamese alternative text and the
      long-press hint, then `Tải PNG` with its busy, failure and unsupported states, and
      `Tải SVG`, both ignoring repeat saves of the same file. It draws nothing until the
      absolute URL is known. Component tests cover the default style, the PNG preview, switching
      by click and keyboard, a late PNG of an earlier style, a PNG finishing after unmount, both
      downloads, repeat clicks, the busy, failure and unsupported states, and the server render.
- [x] 3.2 The published panel renders the section below the sharing note and above
      `Tạm dừng chia sẻ`; its test checks that the section shows and the existing panel tests
      still pass.

## 4. End-to-end

- [x] 4.1 `apps/web/e2e/html-template.spec.ts` checks, after publishing on Free, that the QR
      section shows, that switching styles changes the preview, that the heart and wallpaper PNG
      downloads have the expected names and sizes and decode to the share URL, that the plain SVG
      download is named `qua-tang-qr.svg`, that the preview is a PNG `data:` URL, and that these
      steps make no network request and never navigate the Studio page.

## 5. Verification

- [x] 5.1 `pnpm openspec validate add-gift-qr-codes --strict` and `pnpm spec:check`.
- [x] 5.2 Type check, lint, format check, the unit suite with coverage, and the E2E specs
      `html-template`, `publish` and `gift-lifecycle` on Chromium.

## Out of scope

- The Web Share API, social and bot preview classification, and a print test at target sizes
  (the rest of plan.md §13.3).
- A QR code on the recipient's page or in system emails.
- Custom colours, logos or photos inside the code.
