import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublishedPanel } from "./published-panel";

const shareId = "Ab0_-cdefghijklmnopqrs";
const publication = {
  publishedAt: "2026-10-01T08:00:00.000Z",
  revision: 7,
  shareId,
  sharePath: `/g/${shareId}`,
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PublishedPanel", () => {
  it("shows the heading, the absolute share URL, the link and the notes (Owner reopens a published gift)", () => {
    render(<PublishedPanel hasUnpublishedChanges={false} publication={publication} />);

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
    expect(screen.getByRole("status").textContent).toBe("Người nhận đang xem bản mới nhất.");
    expect(document.body.textContent).not.toContain("không thể chỉnh sửa");
  });

  it("says when recipients still see the earlier publication", () => {
    render(<PublishedPanel hasUnpublishedChanges publication={publication} />);

    expect(screen.getByRole("status").textContent).toBe(
      "Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước đó.",
    );
  });

  it("renders the share path on the server, before the origin is known", () => {
    const html = renderToString(
      <PublishedPanel hasUnpublishedChanges={false} publication={publication} />,
    );

    expect(html).toContain(`value="/g/${shareId}"`);
  });

  it("copies the absolute URL (Copy the link)", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<PublishedPanel hasUnpublishedChanges={false} publication={publication} />);

    await user.click(screen.getByRole("button", { name: "Sao chép liên kết" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/g/${shareId}`);
    expect(screen.getByRole("button", { name: "Đã sao chép" })).toBeTruthy();
  });

  it("asks for a manual copy when the clipboard refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<PublishedPanel hasUnpublishedChanges={false} publication={publication} />);

    await user.click(screen.getByRole("button", { name: "Sao chép liên kết" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.",
    );
    expect(screen.getByRole("button", { name: "Sao chép liên kết" })).toBeTruthy();
  });

  it("selects the link when the field is focused", async () => {
    const user = userEvent.setup();
    render(<PublishedPanel hasUnpublishedChanges={false} publication={publication} />);
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Đường dẫn món quà" });

    await user.click(field);

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });
});
