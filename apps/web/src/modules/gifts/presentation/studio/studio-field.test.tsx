import { parseTemplateManifest } from "@love-memory/template-sdk";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, assetIds, jsonResponse, steppedManifest } from "./test/fixtures";
import {
  patchBodies,
  readyAsset,
  renderEditor,
  setStudioUrl,
  stubStudioFetch,
  track,
} from "./test/render-editor";

vi.mock("next/navigation", () => import("./test/next-navigation"));

const audioManifest = parseTemplateManifest({
  ...steppedManifest,
  fields: [{ id: "audio", label: "Nhạc nền", source: "licensedLibrary", type: "audio" }],
  steps: undefined,
});

const invalidMessage = "Nội dung này chưa hợp lệ, hãy kiểm tra lại.";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setStudioUrl();
});

describe("Studio text inputs", () => {
  it("marks required fields and counts characters like the server", async () => {
    stubStudioFetch();
    const user = userEvent.setup();
    renderEditor();

    const input = screen.getByRole("textbox", { name: "Tên người nhận" });
    await user.type(input, "Người thương");

    expect(screen.getByText("12/40")).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBe("studio-field-receiver-name-counter");
    expect(screen.getAllByText("Bắt buộc").length).toBeGreaterThan(0);
  });

  it("stops input at the field's limit", async () => {
    stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl("?step=opening");
    renderEditor();

    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Lời mở hộp" });
    await user.click(input);
    await user.paste("x".repeat(130));

    expect(input.value).toHaveLength(120);
    expect(screen.getByText("120/120")).toBeTruthy();
  });

  it("removes whitespace-only text from the saved content", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl("?step=letter");
    renderEditor({ content: { "final-letter": "Thư", "receiver-name": "Linh" } });

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lá thư" });
    await user.clear(textarea);
    await user.type(textarea, "   ");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
    expect(patchBodies(fetchMock)[0]?.content).toEqual({ "receiver-name": "Linh" });
    // The draft content drops the whitespace, but the input keeps what the creator typed.
    expect(textarea.value).toBe("   ");
  });

  it("keeps a first space typed into an empty field and the text typed after it", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor();

    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" });
    await user.type(input, " ");
    expect(input.value).toBe(" ");
    expect(screen.getByText("1/40")).toBeTruthy();
    await user.type(input, "Linh");
    expect(input.value).toBe(" Linh");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
    expect(patchBodies(fetchMock)[0]?.content).toEqual({ "receiver-name": " Linh" });
  });
});

describe("Studio field errors", () => {
  it("blocks sending an unavailable audio track until the creator chooses again", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ content: { audio: "old-piano" } });

    const select = screen.getByLabelText<HTMLSelectElement>("Nhạc nền");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe("studio-field-audio-error");
    expect(screen.getByText("Bản nhạc này không còn khả dụng, hãy chọn lại.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Chưa lưu được: Nhạc nền chưa hợp lệ Sửa");

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Lưu ngay" }).disabled).toBe(true);
    await user.selectOptions(select, "Không dùng nhạc");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
    expect(patchBodies(fetchMock)[0]?.content).toEqual({ "receiver-name": "Linh" });
  });

  it("maps a nested server error to its field and clears it when the field changes", async () => {
    const [first, second] = assetIds;
    stubStudioFetch({
      assets: [readyAsset(first), readyAsset(second)],
      patch: () =>
        jsonResponse(
          apiError("VALIDATION_ERROR", { fieldErrors: { "memories.1.caption": "Too long" } }),
          400,
        ),
    });
    const user = userEvent.setup();
    setStudioUrl("?step=memories");
    renderEditor({ content: { memories: [{ assetId: first }, { assetId: second }] } });
    await screen.findByLabelText("Chú thích ảnh 2");

    await user.type(screen.getByLabelText("Chú thích ảnh 2"), "Biển");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    expect(await screen.findByText(invalidMessage)).toBeTruthy();
    expect(screen.queryByText("Too long")).toBeNull();
    expect(screen.getByLabelText("Chọn ảnh").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Chưa lưu được — thử lại");

    await user.click(screen.getAllByRole("button", { name: "Sau" })[0]!);

    await waitFor(() => expect(screen.queryByText(invalidMessage)).toBeNull());
  });

  it("shows keys that name no field once as a general message", async () => {
    stubStudioFetch({
      patch: () =>
        jsonResponse(
          apiError("VALIDATION_ERROR", { fieldErrors: { content: "Unrecognized key" } }),
          400,
        ),
    });
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    expect(await screen.findByText("Một số nội dung chưa hợp lệ với mẫu quà này.")).toBeTruthy();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});

describe("Studio audio field", () => {
  it("saves the chosen catalog track", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ manifest: audioManifest });

    await user.selectOptions(screen.getByLabelText("Nhạc nền"), "Buổi sáng mộc · Nhóm Sóng");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual([
        { content: { audio: "acoustic-morning" }, expectedRevision: 0 },
      ]),
    );
  });

  it("removes the field when the creator chooses no music", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ content: { audio: "acoustic-morning" }, manifest: audioManifest });

    await user.selectOptions(screen.getByLabelText("Nhạc nền"), "Không dùng nhạc");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual([{ content: {}, expectedRevision: 0 }]),
    );
  });

  it("explains an empty catalog and leaves the field empty", () => {
    stubStudioFetch();
    renderEditor({ audioTracks: [], manifest: audioManifest });

    expect(screen.getByText("Chưa có nhạc để chọn")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Đã lưu");
  });

  it("marks a withdrawn stored track as unavailable with an inline error", () => {
    stubStudioFetch();
    renderEditor({
      audioTracks: [track],
      content: { audio: "old-piano" },
      manifest: audioManifest,
    });

    const unavailable = screen.getByRole<HTMLOptionElement>("option", {
      name: "old-piano (không còn khả dụng)",
    });
    expect(unavailable.disabled).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>("Nhạc nền").value).toBe("old-piano");
    expect(screen.getByText("Bản nhạc này không còn khả dụng, hãy chọn lại.")).toBeTruthy();
  });

  it("shows a withdrawn track even when the catalog is empty", () => {
    stubStudioFetch();
    renderEditor({ audioTracks: [], content: { audio: "old-piano" }, manifest: audioManifest });

    expect(screen.getByLabelText<HTMLSelectElement>("Nhạc nền").value).toBe("old-piano");
  });
});

describe("Studio date and theme inputs", () => {
  it("stores and clears a date and a theme", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ content: { theme: "rose-night" } });

    await user.type(screen.getByLabelText("Ngày kỷ niệm"), "2025-02-14");
    await user.click(screen.getByRole("button", { name: /Giao diện & nhạc/ }));
    await user.selectOptions(screen.getByLabelText("Giao diện"), "Mặc định (Đêm hồng)");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() =>
      expect(patchBodies(fetchMock)[0]?.content).toEqual({ "anniversary-date": "2025-02-14" }),
    );
  });

  it("names every theme in Vietnamese and the default choice after the first theme", () => {
    stubStudioFetch();
    renderEditor();

    const options = [
      ...screen.getByLabelText<HTMLSelectElement>("Giao diện").querySelectorAll("option"),
    ].map((option) => option.textContent);
    expect(options).toEqual(["Mặc định (Đêm hồng)", "Đêm hồng", "Giấy ấm"]);
    expect(options.join(" ")).not.toContain("rose-night");
  });
});
