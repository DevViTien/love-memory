import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_NOW, viewerPayload } from "@/modules/viewer/test/viewer-fixtures";

import { PublicGiftScreen } from "./public-gift-screen";

const shareId = "Ab0_-cdefghijklmnopqrs";

function responseFor(overrides: Parameters<typeof viewerPayload>[0] = {}): Response {
  const { issues: _issues, ...viewer } = viewerPayload(overrides);
  return new Response(JSON.stringify({ data: { viewer } }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  // The component reads the real clock; the fixture URLs expire 300 s after `FIXTURE_NOW`. Only
  // `Date` is faked, so timers (and user events) still run in real time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXTURE_NOW);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockReturnValue(undefined);
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(responseFor({ artifactUrl: null })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PublicGiftScreen", () => {
  it("renders the envelope on the server without any gift content", () => {
    const html = renderToString(<PublicGiftScreen shareId={shareId} />);

    expect(html).toContain("Bạn có một món quà");
    expect(html).toContain("Mở quà");
    expect(html).not.toContain("Đà Lạt");
    expect(html).not.toContain("/audio-library/");
    expect(html).not.toContain("<iframe");
  });

  it("shows the Free plan mark over the frame, outside the viewer, without catching taps", () => {
    const { container } = render(<PublicGiftScreen shareId={shareId} watermark />);

    const mark = screen.getByText("Tạo bằng LoveMemory");
    expect(mark.className).toContain("pointer-events-none");
    // A direct child of the frame, beside the viewer: host chrome, never inside the template.
    expect(mark.parentElement).toBe(container.querySelector("[data-public-gift]"));
  });

  it("shows no mark without the watermark", () => {
    render(<PublicGiftScreen shareId={shareId} />);

    expect(screen.queryByText("Tạo bằng LoveMemory")).toBeNull();
  });

  it("sends no request and shows no content before the tap", () => {
    render(<PublicGiftScreen shareId={shareId} />);

    expect(screen.getByRole("button", { name: "Mở quà" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Đà Lạt");
  });

  it("loads the snapshot once on the tap and shows it", async () => {
    const user = userEvent.setup();
    render(<PublicGiftScreen shareId={shareId} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));

    expect(await screen.findByRole("region", { name: "Nội dung món quà" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/public-gifts/${shareId}`);
    expect(document.body.textContent).toContain("Đà Lạt 2023 🌲");
  });

  it("shows the retry message and no content when the link is gone", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    render(<PublicGiftScreen shareId={shareId} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Chưa mở được món quà");
    expect(document.body.textContent).not.toContain("Đà Lạt");
  });

  it("calls the endpoint once more for fresh asset URLs (Refresh of expired asset URLs)", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        responseFor({ artifactUrl: null, assetsExpireAt: "2000-01-01T00:00:00.000Z" }),
      )
      .mockResolvedValueOnce(responseFor({ artifactUrl: null }));
    render(<PublicGiftScreen shareId={shareId} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    await screen.findByRole("region", { name: "Nội dung món quà" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Mở quà" })).toBeNull();
  });
});

describe("PublicGiftScreen funnel analytics", () => {
  const analytics = {
    giftRef: "P".repeat(42) + "1",
    templateId: "memory-box",
    templateVersion: "1.1.0",
  } as const;

  function urlOf(input: RequestInfo | URL): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  }

  function eventNames(): string[] {
    return fetchMock.mock.calls
      .filter(([input]) => urlOf(input) === "/api/events")
      .map(([, init]) => (JSON.parse(init?.body as string) as { name: string }).name);
  }

  function routeEvents(payload: () => Promise<Response>) {
    fetchMock.mockImplementation((input) =>
      urlOf(input) === "/api/events"
        ? Promise.resolve(new Response(null, { status: 204 }))
        : payload(),
    );
  }

  beforeEach(() => {
    window.sessionStorage.clear();
    routeEvents(() => Promise.resolve(responseFor({ artifactUrl: null })));
  });

  it("sends no event before Mở quà, then gift_open_interaction after a successful load", async () => {
    const user = userEvent.setup();
    render(<PublicGiftScreen analytics={analytics} shareId={shareId} />);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    await screen.findByRole("region", { name: "Nội dung món quà" });

    expect(eventNames()).toEqual(["gift_open_interaction"]);
    const [, init] = fetchMock.mock.calls.find(([input]) => urlOf(input) === "/api/events")!;
    expect(init?.credentials).toBe("omit");
    expect(init).not.toHaveProperty("mode");
  });

  it("sends nothing after a failed load, then one event after Thử lại succeeds (Load fails on tap)", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    routeEvents(() =>
      Promise.resolve(
        (attempt += 1) === 1
          ? new Response("{}", { status: 500 })
          : responseFor({ artifactUrl: null }),
      ),
    );
    render(<PublicGiftScreen analytics={analytics} shareId={shareId} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    await screen.findByRole("alert");
    expect(eventNames()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByRole("region", { name: "Nội dung món quà" });
    expect(eventNames()).toEqual(["gift_open_interaction"]);
  });

  it("plays exactly as without analytics when the endpoint fails (Endpoint unavailable)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) =>
      urlOf(input) === "/api/events"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(responseFor({ artifactUrl: null })),
    );
    render(<PublicGiftScreen analytics={analytics} shareId={shareId} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));

    expect(await screen.findByRole("region", { name: "Nội dung món quà" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(eventNames()).toEqual(["gift_open_interaction"]);
  });

  it("sends no event when analytics is null", async () => {
    const user = userEvent.setup();
    render(<PublicGiftScreen analytics={null} shareId={shareId} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    await screen.findByRole("region", { name: "Nội dung món quà" });
    expect(eventNames()).toEqual([]);
  });
});
