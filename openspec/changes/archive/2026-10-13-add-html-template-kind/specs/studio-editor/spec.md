## MODIFIED Requirements

### Requirement: Field inputs and counters

Each field SHALL be rendered in its step with its `label` and, when `required` is `true`, the marker `Bắt buộc`. `shortText` fields SHALL use a single-line input and `longText` fields a multi-line input; both SHALL stop input at the field's `maxLength` and show a counter `{n}/{maxLength}`, where `n` counts characters the way server validation does (UTF-16 code units, so an emoji can count as 2). `date` fields SHALL use a date input, `theme` fields a single choice among the field's `options`, and `audio`, `imageList`, `captionedImageList` and `image` fields SHALL be rendered as specified in `gift-drafts` and `studio-image-list-field`. A field's `helpText` SHALL be shown under its label for every field type, image fields included, and SHALL be referenced first by the `aria-describedby` of each of the field's inputs (before its counter and error). A `textList` field SHALL show one single-line input per line, labelled `{label} {n}`, each stopping at `itemMaxLength` with a counter `{n}/{itemMaxLength}`, the count `{lines}/{maxItems} dòng`, `Thêm dòng` while fewer than `maxItems` lines are shown, and `Lên`, `Xuống` and `Xóa` per line; blank lines stay on screen but are left out of the draft content, and a list without a non-blank line is removed. A `passcode` field SHALL use a numeric text input (`inputmode` `numeric`) that keeps only digits up to `length`, with the counter `{n}/{length}` and the help `Mã số để mở khóa trong món quà, như một trò chơi nhỏ. Đây không phải mật khẩu bảo vệ món quà.`; a value with fewer digits shows `Mã cần đúng {length} chữ số.`. A `color` field SHALL offer a color picker and a hexadecimal text input labelled `{label} (mã màu)`, both storing lowercase `#rrggbb`; an invalid value shows `Màu chưa hợp lệ, hãy chọn lại.`, an empty field reads `Đang dùng màu mặc định của mẫu.`, and `Dùng màu mặc định` clears a chosen color. Each theme option SHALL be labelled with its Vietnamese name (`rose-night` → `Đêm hồng`, `warm-paper` → `Giấy ấm`), and an option without a known name SHALL show its id. Because a template applies the first option when no theme is chosen, the empty choice SHALL read `Mặc định ({name of the first option})`; theme ids such as `rose-night` MUST NOT be shown for options that have a name. A text value that is empty after trimming SHALL be removed from the draft content instead of being kept as whitespace, and a cleared date or theme SHALL be removed as well; the text input itself SHALL keep showing what the creator typed, so a first space typed into an empty field does not disappear.

#### Scenario: Character counter

- **WHEN** the creator types `Người thương` into a `shortText` field with `maxLength` 40
- **THEN** the counter shows `12/40`

#### Scenario: Input stops at the limit

- **WHEN** the creator types or pastes 130 characters into a `shortText` field with `maxLength` 120
- **THEN** the input keeps 120 characters and the counter shows `120/120`

#### Scenario: Whitespace-only text removed

- **WHEN** the creator replaces the text of a `longText` field with only spaces and line breaks
- **THEN** the field's key is removed from the draft content, so the autosave does not send an invalid empty text
- **AND** the input still shows the typed spaces and line breaks

#### Scenario: Leading space kept while typing

- **WHEN** the creator types a space and then `Linh` into an empty `shortText` field
- **THEN** the input shows ` Linh` and the counter shows `5/40` for a field with `maxLength` 40

#### Scenario: Theme names

- **WHEN** the editor renders the `theme` field of `memory-box@1.1.0` with the options `rose-night` and `warm-paper` and no stored value
- **THEN** the choices read `Mặc định (Đêm hồng)`, `Đêm hồng` and `Giấy ấm`, the empty choice is selected, and no choice shows `rose-night` or `warm-paper`

#### Scenario: Help text describes every field

- **WHEN** an `image` field and a `textList` field declare a `helpText`
- **THEN** each help text is shown, and the photo picker and each line input name it first in
  `aria-describedby`

#### Scenario: Text list lines

- **WHEN** the creator types `Một` into line 1 of a `textList` field with `maxItems` 3, adds two
  lines, types `Hai` into line 2 and leaves line 3 blank
- **THEN** the field shows `2/3 dòng`, `Thêm dòng` is disabled, and the saved value is
  `["Một", "Hai"]`

#### Scenario: Passcode keeps digits only

- **WHEN** the creator types `1a2` into a `passcode` field of `length` 4
- **THEN** the input shows `12`, the field shows `Mã cần đúng 4 chữ số.`, and after typing `34`
  the saved value is `1234`

#### Scenario: Color back to the template default

- **WHEN** the creator picks `#FF3366` in a `color` field and then chooses `Dùng màu mặc định`
- **THEN** `#ff3366` is saved first, and then the field is removed from the draft content
