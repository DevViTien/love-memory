## MODIFIED Requirements

### Requirement: Client-side aspect-ratio crop

For each accepted file the field SHALL open a modal crop dialog that previews the image in the template's `aspectRatio` and offers horizontal and vertical focal-point sliders from 0 to 1, both starting at 0.5. Confirming SHALL crop the largest region of the source image that has the target aspect ratio, positioned along the free axis by the focal point and honoring the image's EXIF orientation, SHALL scale the result down so neither side exceeds 2048 pixels, and SHALL request WebP encoding at quality 0.9. The uploaded file's type and extension SHALL match the format the browser actually produced: `image/webp` named `<original name without extension>-cropped.webp`, or, when the browser cannot encode WebP and returns `image/png` or `image/jpeg`, that type with a `.png` or `.jpg` extension. Only the cropped file SHALL be uploaded. Skipping SHALL discard that file and continue with the next one. If cropping fails, the dialog SHALL stay open and show the error.

#### Scenario: Landscape photo cropped to a square frame

- **WHEN** a 4000x2000 photo is confirmed for a field with `aspectRatio` `1:1` and a horizontal focal point of 0
- **THEN** the uploaded file is the 2000x2000 region at the left edge of the photo, encoded as `image/webp`

#### Scenario: Browser without WebP canvas encoding

- **WHEN** the browser returns a PNG from the WebP encoding request
- **THEN** the uploaded file is declared as `image/png` with a `-cropped.png` name, so processing does not reject it as `UPLOAD_INVALID`

#### Scenario: Crop skipped

- **WHEN** the creator chooses to skip an image in the crop dialog
- **THEN** no upload is started for that file and the next selected file, if any, is offered for cropping
