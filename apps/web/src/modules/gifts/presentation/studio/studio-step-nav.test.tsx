import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flatManifest } from "./test/fixtures";
import {
  patchBodies,
  readyAsset,
  renderEditor,
  setStudioUrl,
  stubStudioFetch,
} from "./test/render-editor";

vi.mock("next/navigation", () => import("./test/next-navigation"));

function stepButtons() {
  return within(screen.getByRole("navigation", { name: "Các bước tạo quà" })).getAllByRole(
    "button",
  );
}

function activeStep() {
  return stepButtons().find((button) => button.getAttribute("aria-current") === "step");
}

describe("Studio step navigation", () => {
  let fetchMock: ReturnType<typeof stubStudioFetch>;

  beforeEach(() => {
    setStudioUrl();
    fetchMock = stubStudioFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the template steps and the Studio steps, showing only the active step's fields", () => {
    renderEditor();

    expect(stepButtons().map((button) => button.textContent)).toEqual([
      "1. Người nhậnCòn thiếu",
      "2. Lời mở hộpCòn thiếu",
      "3. Kỷ niệmCòn thiếu",
      "4. Lá thưCòn thiếu",
      "5. Giao diện & nhạcĐã xong",
      "6. Xem trước",
      "7. Xuất bản",
    ]);
    expect(activeStep()?.textContent).toContain("Người nhận");
    expect(screen.getByRole("textbox", { name: "Tên người nhận" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Lá thư" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quay lại" })).toBeNull();
  });

  it("uses one Nội dung step for a manifest without steps", () => {
    renderEditor({ manifest: flatManifest });

    expect(stepButtons().map((button) => button.textContent)).toEqual([
      "1. Nội dungCòn thiếu",
      "2. Xem trước",
      "3. Xuất bản",
    ]);
    const labels = screen.getAllByRole("textbox").map((input) => input.getAttribute("id"));
    expect(labels).toEqual(["studio-field-headline", "studio-field-final-message"]);
    expect(screen.getByLabelText("Chọn ảnh").id).toBe("studio-field-photos");
  });

  it("opens the next step although the current one is incomplete", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(activeStep()?.textContent).toContain("Lời mở hộp");
    expect(window.location.search).toBe("?step=opening");
    expect(document.activeElement?.id).toBe("studio-step-opening");
    await user.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(activeStep()?.textContent).toContain("Người nhận");
  });

  it("keeps content typed on another step and sends it with the next save", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));
    await user.click(screen.getByRole("button", { name: "Quay lại" }));

    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" }).value).toBe(
      "Linh",
    );
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));
    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
    expect(patchBodies(fetchMock)[0]?.content).toEqual({ "receiver-name": "Linh" });
  });

  it("opens and focuses a deep-linked field, then replaces the URL with its step", async () => {
    setStudioUrl("?field=final-letter");
    renderEditor();

    expect(activeStep()?.textContent).toContain("Lá thư");
    await waitFor(() => expect(document.activeElement?.id).toBe("studio-field-final-letter"));
    expect(window.location.search).toBe("?step=letter");
  });

  it.each(["", "?step=unknown-step"])(
    "writes the step that opened into a URL with %j so back returns to it",
    (search) => {
      setStudioUrl(search);
      renderEditor();

      expect(activeStep()?.textContent).toContain("Người nhận");
      expect(window.location.search).toBe("?step=recipient");
    },
  );

  it("lets a field deep link win over the step parameter", async () => {
    setStudioUrl("?step=recipient&field=memories");
    renderEditor();

    expect(activeStep()?.textContent).toContain("Kỷ niệm");
    await waitFor(() => expect(document.activeElement?.id).toBe("studio-field-memories"));
    expect(document.activeElement?.getAttribute("type")).toBe("file");
  });

  it("focuses the image field's legend when a deep-linked picker reaches its limit", async () => {
    const memoryIds = Array.from(
      { length: 8 },
      (_, index) => `550e8400-e29b-41d4-a716-44665544010${index}`,
    );
    stubStudioFetch({ assets: memoryIds.map((assetId) => readyAsset(assetId)) });
    setStudioUrl("?field=memories");
    renderEditor({ content: { memories: memoryIds.map((assetId) => ({ assetId })) } });

    const picker = () => document.getElementById("studio-field-memories") as HTMLInputElement;
    await waitFor(() => expect(picker().disabled).toBe(true));
    await waitFor(() => expect(document.activeElement?.tagName).toBe("LEGEND"));
    expect(document.activeElement?.textContent).toBe("Kỷ niệm");
  });

  it("focuses the legend when a Sửa link targets a picker that is already disabled", async () => {
    const memoryIds = Array.from(
      { length: 9 },
      (_, index) => `550e8400-e29b-41d4-a716-44665544020${index}`,
    );
    stubStudioFetch({ assets: memoryIds.map((assetId) => readyAsset(assetId)) });
    const user = userEvent.setup();
    setStudioUrl("?step=letter");
    renderEditor({ content: { memories: memoryIds.map((assetId) => ({ assetId })) } });
    const picker = document.getElementById("studio-field-memories") as HTMLInputElement;
    await waitFor(() => expect(picker.disabled).toBe(true));

    await user.click(screen.getByRole("link", { name: "Sửa" }));

    expect(activeStep()?.textContent).toContain("Kỷ niệm");
    expect(document.activeElement?.tagName).toBe("LEGEND");
    expect(document.activeElement?.textContent).toBe("Kỷ niệm");
  });

  it.each(["?field=not-a-field", "?step=not-a-step"])("opens the first step for %s", (search) => {
    setStudioUrl(search);
    renderEditor();

    expect(activeStep()?.textContent).toContain("Người nhận");
  });

  it("opens a step from the navigation and focuses its heading", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(stepButtons()[3]!);

    expect(activeStep()?.textContent).toContain("Lá thư");
    expect(window.location.search).toBe("?step=letter");
    expect(document.activeElement?.id).toBe("studio-step-letter");
    expect(screen.getByRole("heading", { name: "Lá thư" })).toBeTruthy();
  });

  it("marks a step as done once its last required field is filled", async () => {
    const user = userEvent.setup();
    renderEditor({ content: { "receiver-name": "Linh" } });
    await user.click(stepButtons()[1]!);

    await user.type(screen.getByRole("textbox", { name: "Lời mở hộp" }), "Mở hộp nhé");

    expect(stepButtons()[1]?.textContent).toBe("2. Lời mở hộpĐã xong");
    expect(stepButtons()[0]?.textContent).toBe("1. Người nhậnĐã xong");
  });
});
