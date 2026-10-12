import { parseTemplateManifest } from "@love-memory/template-sdk";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assetIds, steppedManifest } from "./test/fixtures";
import {
  patchBodies,
  readyAsset,
  renderEditor,
  setStudioUrl,
  stubStudioFetch,
} from "./test/render-editor";

vi.mock("next/navigation", () => import("./test/next-navigation"));

/** The new field types of `html` templates, one step each (`studio-editor` "Field inputs"). */
const htmlManifest = parseTemplateManifest({
  ...steppedManifest,
  entry: "index.html",
  fields: [
    {
      helpText: "Mỗi dòng là một lời nhắn.",
      id: "lines",
      itemMaxLength: 20,
      label: "Lời nhắn",
      maxItems: 3,
      minItems: 1,
      path: "lines",
      required: true,
      type: "textList",
    },
    {
      aspectRatio: "1:1",
      helpText: "Không có ảnh thì hiện chữ cái đầu.",
      id: "avatar",
      label: "Ảnh đại diện",
      path: "avatar",
      type: "image",
    },
    { id: "pin", label: "Mã mở khóa", length: 4, path: "pin", type: "passcode" },
    { id: "accent", label: "Màu nhấn", path: "accent", type: "color" },
  ],
  kind: "html",
  steps: [
    { fieldIds: ["lines"], id: "lines", label: "Lời nhắn" },
    { fieldIds: ["avatar"], id: "avatar", label: "Ảnh" },
    { fieldIds: ["pin", "accent"], id: "extras", label: "Thêm" },
  ],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setStudioUrl();
});

async function savedContent(fetchMock: ReturnType<typeof stubStudioFetch>) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Lưu ngay" }));
  await waitFor(() => expect(patchBodies(fetchMock).length).toBeGreaterThan(0));
  return patchBodies(fetchMock).at(-1)?.content;
}

describe("Studio text list field", () => {
  it("adds, edits, moves and removes lines, saving only the non-blank ones", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ manifest: htmlManifest });

    expect(screen.getByText("Mỗi dòng là một lời nhắn.")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Lời nhắn 1" }), "Một");
    await user.click(screen.getByRole("button", { name: "Thêm dòng" }));
    await user.type(screen.getByRole("textbox", { name: "Lời nhắn 2" }), "Hai");
    await user.click(screen.getByRole("button", { name: "Thêm dòng" }));
    expect(screen.getByText("2/3 dòng")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Thêm dòng" }).disabled).toBe(
      true,
    );
    expect(screen.getAllByText("3/20")).toHaveLength(2);
    expect(screen.getByText("0/20")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Đưa dòng 2 lên" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Lời nhắn 1" }).value).toBe("Hai");
    await user.click(screen.getByRole("button", { name: "Đưa dòng 1 xuống" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Lời nhắn 1" }).value).toBe("Một");

    expect(await savedContent(fetchMock)).toEqual({ lines: ["Một", "Hai"] });

    await user.click(screen.getByRole("button", { name: "Xóa dòng 1" }));
    await user.click(screen.getByRole("button", { name: "Xóa dòng 1" }));
    await user.click(screen.getByRole("button", { name: "Xóa dòng 1" }));
    expect(screen.getAllByRole("textbox", { name: /^Lời nhắn \d$/ })).toHaveLength(1);
  });

  it("stops each line at its limit and shows stored lines", () => {
    stubStudioFetch();
    renderEditor({ content: { lines: ["Đã lưu"] }, manifest: htmlManifest });

    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Lời nhắn 1" });
    expect(input.value).toBe("Đã lưu");
    expect(input.maxLength).toBe(20);
    expect(input.id).toBe("studio-field-lines");
  });
});

describe("Studio single image field", () => {
  it("shows one photo slot and keeps a stored photo", async () => {
    const [first] = assetIds;
    stubStudioFetch({ assets: [readyAsset(first, "avatar")] });
    setStudioUrl("?step=avatar");
    renderEditor({ content: { avatar: first }, manifest: htmlManifest });

    expect(await screen.findByText("1/1 ảnh")).toBeTruthy();
    expect(screen.getByText(/Một ảnh · JPEG, PNG hoặc WebP/)).toBeTruthy();
  });
});

describe("Studio help text (Help text describes every field)", () => {
  it("shows the help of photo and text list fields and links it to their inputs", () => {
    stubStudioFetch();
    renderEditor({ manifest: htmlManifest });

    expect(
      screen.getByRole("textbox", { name: "Lời nhắn 1" }).getAttribute("aria-describedby"),
    ).toBe("studio-field-lines-help studio-field-lines-counter");
    cleanup();

    stubStudioFetch();
    setStudioUrl("?step=avatar");
    renderEditor({ manifest: htmlManifest });
    expect(screen.getByText("Không có ảnh thì hiện chữ cái đầu.").id).toBe(
      "studio-field-avatar-help",
    );
    expect(screen.getByLabelText("Chọn ảnh").getAttribute("aria-describedby")).toBe(
      "studio-field-avatar-help",
    );
  });

  it("describes an invalid field by its help, then its error", async () => {
    stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl("?step=extras");
    const manifest = parseTemplateManifest({
      ...htmlManifest,
      fields: htmlManifest.fields.map((field) =>
        field.id === "pin" ? { ...field, helpText: "Bốn số." } : field,
      ),
    });
    renderEditor({ content: { lines: ["x"] }, manifest });

    await user.type(screen.getByLabelText("Mã mở khóa"), "1");

    expect(screen.getByLabelText("Mã mở khóa").getAttribute("aria-describedby")).toBe(
      "studio-field-pin-help studio-field-pin-passcode-help studio-field-pin-counter studio-field-pin-error",
    );
  });
});

describe("Studio passcode and color fields", () => {
  it("keeps only digits up to the length and explains that it is not a protection", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl("?step=extras");
    renderEditor({ content: { lines: ["x"] }, manifest: htmlManifest });

    const pin = screen.getByLabelText<HTMLInputElement>("Mã mở khóa");
    expect(pin.inputMode).toBe("numeric");
    expect(pin.maxLength).toBe(4);
    expect(screen.getByText(/không phải mật khẩu bảo vệ món quà/)).toBeTruthy();
    await user.type(pin, "1a2");
    expect(pin.value).toBe("12");
    expect(screen.getByText("Mã cần đúng 4 chữ số.")).toBeTruthy();
    expect(pin.getAttribute("aria-invalid")).toBe("true");
    await user.type(pin, "34");
    expect(screen.queryByText("Mã cần đúng 4 chữ số.")).toBeNull();

    expect(await savedContent(fetchMock)).toEqual({ lines: ["x"], pin: "1234" });
  });

  it("picks a color or takes a hex code, and returns to the template default", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl("?step=extras");
    renderEditor({ content: { lines: ["x"] }, manifest: htmlManifest });

    expect(screen.getByText("Đang dùng màu mặc định của mẫu.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Màu nhấn"), { target: { value: "#FF3366" } });
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Màu nhấn (mã màu)" }).value).toBe(
      "#ff3366",
    );
    expect(await savedContent(fetchMock)).toEqual({ accent: "#ff3366", lines: ["x"] });

    const hex = screen.getByRole("textbox", { name: "Màu nhấn (mã màu)" });
    await user.clear(hex);
    await user.type(hex, "#12");
    expect(screen.getByText("Màu chưa hợp lệ, hãy chọn lại.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Màu nhấn").value).toBe("#000000");

    await user.click(screen.getByRole("button", { name: "Dùng màu mặc định" }));
    expect(screen.getByText("Đang dùng màu mặc định của mẫu.")).toBeTruthy();
  });
});
