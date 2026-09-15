import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { Container } from "./container";
import { cn } from "./lib/cn";

describe("UI primitives", () => {
  it("forwards semantic attributes and custom classes", () => {
    render(
      <Container aria-label="Memory area" className="py-4">
        <Badge title="Status">Published</Badge>
      </Container>,
    );

    expect(screen.getByLabelText("Memory area").className).toContain("py-4");
    expect(screen.getByTitle("Status").textContent).toBe("Published");
  });

  it("merges conflicting Tailwind classes deterministically", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4");
  });
});
