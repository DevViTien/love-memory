import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ViewerShell } from "./viewer-shell";

function fromTemplate(frame: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
  });
}

describe("Viewer harness", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays a template through its scenes to the end without any /api/events request", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<ViewerShell artifactUrl="about:blank" payload={{ "receiver-name": "Minh Thư" }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const frame = screen.getByTitle<HTMLIFrameElement>("LoveMemory template viewer");

    fromTemplate(frame, { protocolVersion: 1, type: "READY" });
    await user.click(screen.getByRole("button", { name: "Phát" }));
    for (const sceneId of ["opening", "memory-1", "letter", "finale"]) {
      fromTemplate(frame, { sceneId, type: "SCENE" });
    }
    fromTemplate(frame, { type: "COMPLETE" });

    expect(screen.getByText(/Sự kiện hợp lệ:/).parentElement?.textContent).toContain("6");
    expect(fetchMock.mock.calls.some(([input]) => input === "/api/events")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
