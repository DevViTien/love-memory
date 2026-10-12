# Design: gift QR codes

## Context

- **What exists.** The published panel (`published-panel.tsx`) shows the share path in the server
  render. After hydration it shows the absolute URL built from `window.location.origin`, so the
  API never needs `APP_URL`.
- **The decision.** Decision T8 of
  [the template pivot plan](../../../docs/sprints/template-pivot-plan.md) asks for a QR code of
  that URL in three styles, downloadable as PNG and SVG, generated in the browser.

## Decisions

### D1. Matrix from `qrcode`, SVG built by hand

`qrcode` (1.5.4) is the most widely used QR encoder on npm, and its browser entry needs no Node
built-ins. We call only `create(text, { errorCorrectionLevel: "H" })` and read the module matrix.
Its own renderers are not used. A matrix is easy to test, and drawing it ourselves gives control
over the decoration.

`gift-qr-code.ts` is pure and lives in `modules/gifts/presentation/studio/`, so the coverage gate
applies:

- `createQrMatrix` gives a row-major list of booleans;
- `qrModulesPath` draws one rectangle per horizontal run of dark modules, in whole pixels;
- `buildQrImage(matrix, style)` returns `{ svg, width, height }`.

Level H tolerates about 30 % damage. It is not needed for the decoration, which never covers the
code, but it gives margin for printing on textured paper or a phone wallpaper behind icons.

### D2. Geometry

Each style's SVG has `width`, `height` and `viewBox` equal to its PNG size, so one coordinate
space serves both formats.

- **Module size.** It is `floor(side / (size + 8))` pixels, a whole number. That leaves 4 modules
  of quiet zone on each side, and the remainder becomes extra margin. Edges are crisp
  (`shape-rendering="crispEdges"` on the code) and no seams appear between rows.
- **Module sizes in practice.** The production share URL (`https://…/g/{22 chars}`, 46 bytes)
  needs version 6 (41 modules): 20 px per module in `plain`, 10 px in `heart` and 14 px in
  `wallpaper`. A long preview-deployment URL (74 bytes) needs version 8 (49 modules): 17, 8 and
  12 px.
- **Rounded corners.** A white card with corner radius r cuts r(1 − 1/√2) into its diagonal.
  `qrCard` lowers the radius until the corners of the quiet zone stay white.
- **Heart.** A heart path in a 100-unit box, scaled to 1024. The largest centred square inside it
  is about 50.8 units wide (computed numerically against the path). The card is 48.5 units
  (497 px) with its top at 21 units: anywhere from 19 (the notch) to 22.5 fits, so 21 leaves a
  margin at the notch and at the lower curves. An inner light outline decorates the heart.
  Colours are the brand's rose: `#fb7185` to `#e11d48`.
- **Wallpaper.** The code sits on a 720 px white square, horizontally centred, at y = 900–1620
  of a 1080 × 2340 image. That is just below the middle of the screen, under the heading, where
  lock-screen clocks do not cover it. Above it are a small heart and `Quét để mở món quà` in a
  system font stack; below it is `Một món quà dành riêng cho bạn`. The text is fixed: the SVG
  never contains the URL, the gift's text or an external reference.

### D3. PNG in the browser

`renderQrPng` loads the SVG as a `data:` image, draws it on a canvas of the style's size and calls
`toBlob("image/png")`. An SVG `data:` image without `foreignObject` does not taint the canvas.
The canvas is shrunk to 0 × 0 once encoded, or once it fails, because iOS caps the total canvas
memory of a page.

**Saving.** `saveBlob` clicks a temporary `<a download target="_blank" rel="noopener">` to a
`blob:` URL and revokes the URL after 10 s; revoking at once can cancel the download in some
browsers. It acts only when `"download" in HTMLAnchorElement.prototype`. Otherwise it returns
`false`, and the section points to the long press instead. The `_blank` target is a second guard:
a browser that reports the attribute but ignores it opens the file in a new context rather than
replacing the Studio page.

**Mobile.** On iOS, `<a download>` saves to Files in Safari and is ignored by in-app browsers
(Zalo, Messenger, Facebook). A long press on an image works everywhere, but some in-app browsers
cannot save a `blob:` image. So the preview is the style's PNG as a `data:` URL, read from the
PNG blob with `FileReader`:

- it is drawn whenever the style changes;
- the SVG `data:` URL is shown until it is ready, or if it fails;
- a PNG that finishes after a style change or an unmount is dropped, and sets no state;
- `Tải PNG` reuses the previewed PNG blob when it is ready.

Downloads still go through `blob:` URLs. A save of the same file name (style and format) is
ignored while it runs and for one second after it (`QR_SAVE_COOLDOWN_MS`), so a double click
saves one file while another style still saves at once.

The hint `Trên điện thoại: nhấn giữ ảnh để lưu vào thư viện ảnh.` sits under the preview.

Both steps take injectable dependencies (`createCanvas`, `loadImage`), so jsdom tests cover their
failure paths. A failure shows `Không tạo được ảnh PNG. Hãy thử tải SVG.`

### D4. Rendering and state

- **Section.** `GiftQrSection({ shareUrl })` memoizes the matrix per URL and the image per style.
  While `shareUrl` is not absolute, during the server render and the first hydration pass, it
  shows only the heading and the introduction. So the server never computes a code for a
  half-known URL, and hydration does not mismatch.
- **Style choice.** A native radio group, shown as a segmented control: `sr-only` inputs inside
  labels with a focus ring. It is reachable with the keyboard and its arrow keys. The selected
  option is not marked by colour alone: it adds a check icon, a bold label and a 2 px `rose-600`
  border (4.5:1 on white).
- **Preview.** An `<img>` with a Vietnamese alternative text. It is constrained to the panel width
  at 320 px, and the wallpaper preview is limited in height.

### D5. No CSP or server change

The Studio is a nonce-CSP route (`content-security-policy`). Its `img-src` already contains
`data:` and `blob:`. A `blob:` download is a navigation to a download, which no directive governs.
No route, collection, job or cache is touched, so there is no migration, authorization or retry
behaviour to design. The QR content is the share URL, which the panel already shows to its
authorized owner.

## Risks / Trade-offs

- **Bundle size.** `qrcode` adds a few tens of kB, minified, to the Studio's client bundle, which
  already includes the published panel. A dynamic import is possible later if the bundle budget
  needs it.
- **Fonts in the wallpaper.** The text uses the viewer's system fonts when the SVG is drawn. The
  PNG therefore differs slightly across platforms. The code itself does not depend on fonts.
- **Canvas fingerprinting defences.** Firefox with `privacy.resistFingerprinting` and Brave can
  randomise or blank canvas reads. The PNG (and so the preview) may then be blank or noisy. The
  SVG download does not use a canvas and still works, and the PNG failure message points to it.
  We cannot detect a randomised canvas reliably.
- **Test dependencies.** The decode tests rasterize SVG with `sharp` (librsvg). That is a different
  renderer from the browser's, which the E2E covers with a real Chromium download.
