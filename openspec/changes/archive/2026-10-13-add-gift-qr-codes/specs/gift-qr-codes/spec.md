# Spec Delta

## Purpose

Gives the owner of a published gift its share link as a QR code, in styles meant for printing,
sending and a phone wallpaper, generated in the browser and downloadable as PNG and SVG.

## ADDED Requirements

### Requirement: QR code of the share URL

The published panel of `gift-publishing` ("Published gift in the Studio") SHALL contain a section
labelled by the heading `Mã QR`. Once the browser knows the absolute share URL (the application
origin followed by `/g/{shareId}`, the value of `Đường dẫn món quà`), the section SHALL show a QR
code that encodes exactly that URL and nothing else, at error correction level H.

The code SHALL be generated in the browser. Generating, previewing and downloading it MUST NOT send
any request, and no QR image SHALL be stored on the server. The server render SHALL show the heading
without a code, because it does not know the origin.

The section SHALL offer the styles as a radio group with the legend `Kiểu mã QR`:

| Style       | Label                 | Image                                                                                                                                                                    |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plain`     | `Cơ bản`              | 1024 × 1024 pixels: the code on white.                                                                                                                                   |
| `heart`     | `Khung trái tim`      | 1024 × 1024 pixels: a rose heart around a white square that holds the code.                                                                                              |
| `wallpaper` | `Hình nền điện thoại` | 1080 × 2340 pixels: a soft rose gradient, the line `Quét để mở món quà`, the code on a white square horizontally centred below it, and `Một món quà dành riêng cho bạn`. |

`Cơ bản` SHALL be selected when the section appears. The selected option SHALL be marked by more
than colour: a check mark, a bold label and a border of at least 3:1 contrast.

In every style the modules SHALL be dark (`#1c1917`) on white, square and unobstructed: decoration
only surrounds the white square. All modules SHALL measure the same whole number of pixels in the
image. The white square SHALL keep a light quiet zone of at least 4 modules on every side of the
code, corners included. An image MUST NOT contain the share URL as text, any text of the gift, or
any external reference.

The preview SHALL show the selected style with the alternative text
`Mã QR mở món quà, kiểu {label}`. It SHALL be the style's PNG, as a `data:` URL, once the browser
has drawn it, and its SVG until then or when the PNG cannot be drawn. A PNG drawn for an earlier
style SHALL never replace the preview of the current one. Under the preview the section SHALL show
`Trên điện thoại: nhấn giữ ảnh để lưu vào thư viện ảnh.`, because a long press on an image saves
it in mobile browsers, including in-app browsers that ignore downloads.

#### Scenario: Plain code shown after publishing

- **WHEN** the owner opens `/studio/{publicId}` of a published gift
- **THEN** the panel shows `Mã QR` with `Cơ bản` selected and an image named
  `Mã QR mở món quà, kiểu Cơ bản` whose code decodes to the share URL

#### Scenario: Style switched

- **WHEN** the owner chooses `Khung trái tim`
- **THEN** the preview is named `Mã QR mở món quà, kiểu Khung trái tim` and still decodes to the
  share URL

#### Scenario: Each style scans

- **WHEN** each style is rendered at its full size and read by a QR decoder, for a share URL of
  up to 74 characters
- **THEN** the decoder returns exactly the share URL

#### Scenario: Heart scans when printed small

- **WHEN** the `heart` image of a share URL is scaled down to 300 × 300 pixels and read by a QR
  decoder
- **THEN** the decoder returns exactly the share URL

#### Scenario: Saving on a phone

- **WHEN** the owner opens the published panel on a phone
- **THEN** the preview is an image of the selected style, and the section shows
  `Trên điện thoại: nhấn giữ ảnh để lưu vào thư viện ảnh.` under it

#### Scenario: Server render without an origin

- **WHEN** the panel is rendered on the server
- **THEN** it shows the heading `Mã QR` and neither a code nor the download buttons

### Requirement: QR downloads

The section SHALL offer the buttons `Tải PNG` and `Tải SVG`, which save the selected style:

- `Tải SVG` saves the style's SVG;
- `Tải PNG` saves the PNG drawn in the browser from that SVG at the style's full size, the same
  one as the preview. When it is not drawn yet, it is drawn first: meanwhile the button reads
  `Đang tạo PNG…` and is disabled. When the browser cannot draw it, the section shows
  `Không tạo được ảnh PNG. Hãy thử tải SVG.` until the style changes or the next attempt.

A save of the same file (style and format) SHALL be ignored while it runs and for one second
after it; another style saves at once. A download MUST NOT navigate the Studio page. In a browser without support for the `download` attribute of
links, the buttons save nothing and the section shows
`Trình duyệt này không tải được tệp. Hãy nhấn giữ ảnh ở trên để lưu.`

The files SHALL be named by style and format only: `qua-tang-qr`, `qua-tang-qr-trai-tim` or
`qua-tang-qr-hinh-nen`, followed by `.png` or `.svg`. A file name MUST NOT contain the share id,
the public id or any text of the gift. Downloads SHALL go through a local `blob:` URL, and no
download SHALL record an analytics event.

#### Scenario: Heart PNG downloaded

- **WHEN** the owner selects `Khung trái tim` and chooses `Tải PNG`
- **THEN** the browser saves `qua-tang-qr-trai-tim.png`, a 1024 × 1024 PNG whose code decodes to
  the share URL

#### Scenario: Wallpaper PNG downloaded

- **WHEN** the owner selects `Hình nền điện thoại` and chooses `Tải PNG`
- **THEN** the browser saves `qua-tang-qr-hinh-nen.png`, a 1080 × 2340 PNG whose code decodes to
  the share URL

#### Scenario: Plain SVG downloaded

- **WHEN** the owner selects `Cơ bản` and chooses `Tải SVG`
- **THEN** the browser saves `qua-tang-qr.svg`, a 1024 × 1024 SVG that does not contain the share
  URL as text

#### Scenario: Double click saves once

- **WHEN** the owner double-clicks `Tải SVG`
- **THEN** the browser saves one file

#### Scenario: Another style right after

- **WHEN** the owner saves the `Khung trái tim` PNG and, within a second, the
  `Hình nền điện thoại` PNG
- **THEN** the browser saves both files

#### Scenario: Browser without downloads

- **WHEN** the owner chooses `Tải PNG` in a browser without support for the `download` attribute
- **THEN** nothing is saved, the Studio page stays open and the section shows
  `Trình duyệt này không tải được tệp. Hãy nhấn giữ ảnh ở trên để lưu.`

#### Scenario: PNG cannot be drawn

- **WHEN** the browser fails to draw the PNG
- **THEN** the preview stays the SVG, `Tải PNG` saves nothing and the section shows
  `Không tạo được ảnh PNG. Hãy thử tải SVG.`
