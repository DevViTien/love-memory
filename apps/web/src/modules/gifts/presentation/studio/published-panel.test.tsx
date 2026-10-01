import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublishedPanel } from "./published-panel";

const shareId = "Ab0_-cdefghijklmnopqrs";
const publication = {
  publicId: "q1w2e3r4t5y6u7i8",
  publishedAt: "2026-10-01T08:00:00.000Z",
  revision: 7,
  shareId,
  sharePath: `/g/${shareId}`,
  status: "published",
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PublishedPanel", () => {
  it("shows the heading, the absolute share URL, the link and the notes", () => {
    render(<PublishedPanel publication={publication} />);

    expect(screen.getByRole("heading", { name: "Đã xuất bản" })).toBeTruthy();
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Đường dẫn món quà" });
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(`${window.location.origin}/g/${shareId}`);
    const open = screen.getByRole("link", { name: "Mở món quà" });
    expect(open.getAttribute("href")).toBe(`/g/${shareId}`);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      screen.getByText("Ai có đường dẫn này đều mở được món quà. Chỉ chia sẻ với người nhận."),
    ).toBeTruthy();
    expect(screen.getByText("Món quà đã xuất bản không thể chỉnh sửa.")).toBeTruthy();
  });

  it("renders the share path on the server, before the origin is known", () => {
    const html = renderToString(<PublishedPanel publication={publication} />);

    expect(html).toContain(`value="/g/${shareId}"`);
  });

  it("copies the absolute URL (Copy the link)", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<PublishedPanel publication={publication} />);

    await user.click(screen.getByRole("button", { name: "Sao chép liên kết" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/g/${shareId}`);
    expect(screen.getByRole("button", { name: "Đã sao chép" })).toBeTruthy();
  });

  it("asks for a manual copy when the clipboard refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<PublishedPanel publication={publication} />);

    await user.click(screen.getByRole("button", { name: "Sao chép liên kết" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.",
    );
    expect(screen.getByRole("button", { name: "Sao chép liên kết" })).toBeTruthy();
  });

  it("selects the link when the field is focused", async () => {
    const user = userEvent.setup();
    render(<PublishedPanel publication={publication} />);
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Đường dẫn món quà" });

    await user.click(field);

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });
});
