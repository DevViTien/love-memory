import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanChoice, planOptions, selectedPlan } from "./plan-choice";
import {
  formatExpiry,
  formatPhotoLimit,
  formatPlanPrice,
  formatRetention,
  formatWatermark,
  planName,
} from "./plan-format";
import { studioPlanOffers } from "./test/render-editor";

afterEach(() => {
  cleanup();
});

describe("plan formatting", () => {
  it("formats prices, limits, watermark and retention from the plan values", () => {
    expect(formatPlanPrice(0)).toBe("Miễn phí");
    expect(formatPlanPrice(49_000)).toBe("49.000đ");
    expect(formatPhotoLimit(3)).toBe("Tối đa 3 ảnh");
    expect(formatPhotoLimit(null)).toBe("Tất cả ảnh mẫu quà cho phép");
    expect(formatWatermark(true)).toBe("Có dòng chữ “Tạo bằng LoveMemory”");
    expect(formatWatermark(false)).toBe("Không có dòng chữ “Tạo bằng LoveMemory”");
    expect(formatRetention(14)).toBe("Người nhận mở được trong 14 ngày");
    expect(formatRetention(365)).toBe("Người nhận mở được trong 1 năm");
  });

  it("formats an expiry in Vietnam time whatever the browser's zone", () => {
    expect(formatExpiry("2026-10-22T10:00:00.000Z")).toBe("17:00 22/10/2026");
    expect(formatExpiry("2026-12-31T17:30:00.000Z")).toBe("00:30 01/01/2027");
  });

  it("names a plan from the offers, or by its id without them", () => {
    expect(planName(studioPlanOffers(), "standard")).toBe("Tiêu chuẩn");
    expect(planName([], "free")).toBe("free");
  });
});

describe("plan options", () => {
  it("disables an unavailable plan before a photo limit", () => {
    const options = planOptions(studioPlanOffers(), 5);

    expect(options.map((option) => option.disabledReason)).toEqual([
      "Món quà đang có 5 ảnh, gói này cho tối đa 3 ảnh.",
      "Sắp mở thanh toán.",
    ]);
    expect(selectedPlan(options, null)).toBeNull();
  });

  it("selects the first enabled plan by default, and the creator's choice while it fits", () => {
    const options = planOptions(studioPlanOffers("internal"), 3);

    expect(selectedPlan(options, null)?.planId).toBe("free");
    expect(selectedPlan(options, "standard")?.planId).toBe("standard");
  });

  it("moves the selection when the chosen plan no longer fits (Selection follows the photo count)", () => {
    const offers = studioPlanOffers("internal");

    expect(selectedPlan(planOptions(offers, 3), "free")?.planId).toBe("free");
    expect(selectedPlan(planOptions(offers, 4), "free")?.planId).toBe("standard");
  });
});

describe("PlanChoice", () => {
  it("renders the radio group, its notes and reports a choice", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PlanChoice
        disabled={false}
        onSelect={onSelect}
        options={planOptions(studioPlanOffers("internal"), 3)}
        selectedPlanId="free"
      />,
    );

    expect(screen.getByRole("group", { name: "Chọn gói" })).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: /^Miễn phí · Miễn phí/ }).checked,
    ).toBe(true);
    expect(screen.getByText("Cấp nội bộ để thử nghiệm, không thu phí.")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /^Tiêu chuẩn · 49\.000đ/ }));
    expect(onSelect).toHaveBeenCalledWith("standard");
  });

  it("disables every option while the confirmation is open", () => {
    render(
      <PlanChoice
        disabled
        onSelect={() => undefined}
        options={planOptions(studioPlanOffers("internal"), 3)}
        selectedPlanId="free"
      />,
    );

    for (const radio of screen.getAllByRole<HTMLInputElement>("radio")) {
      expect(radio.disabled).toBe(true);
    }
  });
});
