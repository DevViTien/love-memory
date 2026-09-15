import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders an accessible button and handles interaction", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Button onClick={onClick}>Tạo kỷ niệm</Button>);
    await user.click(screen.getByRole("button", { name: "Tạo kỷ niệm" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not trigger when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button disabled onClick={onClick}>
        Đang xử lý
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Đang xử lý" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
