import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ViewerPayload } from "../application/viewer-payload";
import { completeContent, FIXTURE_NOW, viewerPayload } from "../test/viewer-fixtures";
import { GiftViewer } from "./gift-viewer";

function staticViewer(overrides: Partial<ViewerPayload> = {}): ViewerPayload {
  return viewerPayload({ artifactUrl: null, ...overrides });
}

beforeEach(() => {
  // The component reads the real clock; the fixture URLs expire 300 s after `FIXTURE_NOW`. Only
  // `Date` is faked, so timers (and user events) still run in real time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXTURE_NOW);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe("GiftViewer", () => {
  it("starts with an envelope that shows no gift content", () => {
    render(<GiftViewer source={{ kind: "ready", viewer: viewerPayload() }} />);

    expect(screen.getByRole("heading", { name: "Bạn có một món quà" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mở quà" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Đà Lạt");
    expect(document.body.textContent).not.toContain("An");
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("title")).toBe("LoveMemory template viewer");
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.getAttribute("tabindex")).toBe("-1");
    expect(document.querySelector("audio")?.getAttribute("preload")).toBe("none");
  });

  it("creates the iframe only on the client, together with its artifact URL (Initial blank document load)", () => {
    const html = renderToString(<GiftViewer source={{ kind: "ready", viewer: viewerPayload() }} />);

    // No iframe in the server HTML: it could load before the client attached its listener.
    expect(html).not.toContain("<iframe");

    render(<GiftViewer source={{ kind: "ready", viewer: viewerPayload() }} />);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(viewerPayload().artifactUrl);
  });

  it("starts the handshake only for a load of the artifact URL", () => {
    render(<GiftViewer source={{ kind: "ready", viewer: viewerPayload() }} />);
    const frame = document.querySelector("iframe")!;
    const artifactUrl = frame.getAttribute("src")!;

    // The initial about:blank document of a freshly inserted iframe. Changing `src` gives the
    // iframe a new window, so each spy is taken after the change.
    frame.setAttribute("src", "about:blank");
    const blank = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.load(frame);
    expect(blank).not.toHaveBeenCalled();

    frame.setAttribute("src", artifactUrl);
    const artifact = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.load(frame);
    expect(artifact).toHaveBeenCalledWith(expect.objectContaining({ type: "INIT" }), "*");
  });

  it("tells the host page once that the runtime is ready, behind the envelope", () => {
    const onRuntimeSettled = vi.fn();
    render(
      <GiftViewer
        onRuntimeSettled={onRuntimeSettled}
        source={{ kind: "ready", viewer: viewerPayload() }}
      />,
    );
    const frame = document.querySelector("iframe")!;
    const template = frame.contentWindow!;
    fireEvent.load(frame);
    act(() => {
      for (let index = 0; index < 2; index += 1) {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { protocolVersion: 1, type: "READY" },
            source: template,
          }),
        );
      }
    });

    expect(onRuntimeSettled.mock.calls).toEqual([["ready"]]);
    expect(screen.getByRole("button", { name: "Mở quà" })).toBeTruthy();
  });

  it("moves focus to the static content when the template fails during the gift", async () => {
    const user = userEvent.setup();
    render(<GiftViewer source={{ kind: "ready", viewer: viewerPayload() }} />);
    const frame = document.querySelector("iframe")!;
    const template = frame.contentWindow!;
    const fromTemplate = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source: template }));
      });
    fireEvent.load(frame);
    fromTemplate({ protocolVersion: 1, type: "READY" });
    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    expect(document.activeElement).toBe(frame);

    fromTemplate({ code: "RUNTIME_ERROR", type: "ERROR" });

    expect(document.querySelector("iframe")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Nội dung món quà");
  });

  it("renders no content and no iframe for a deferred source before the tap", async () => {
    const user = userEvent.setup();
    let resolve: (viewer: ViewerPayload) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<ViewerPayload>((settle) => {
          resolve = settle;
        }),
    );
    render(<GiftViewer source={{ kind: "deferred", load }} />);

    expect(document.querySelector("iframe")).toBeNull();
    expect(load).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    expect(screen.getByRole("status").textContent).toBe("Đang mở quà…");
    expect(document.querySelector("iframe")).toBeNull();

    await act(async () => {
      resolve(viewerPayload());
      await Promise.resolve();
    });
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(viewerPayload().artifactUrl);
  });

  it("keeps keyboard focus on the opening status, then on Thử lại (Keyboard focus while opening)", async () => {
    const user = userEvent.setup();
    let reject: (error: Error) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<ViewerPayload>((_resolve, fail) => {
          reject = fail;
        }),
    );
    render(<GiftViewer source={{ kind: "deferred", load }} />);

    screen.getByRole("button", { name: "Mở quà" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("status"));

    await act(async () => {
      reject(new Error("offline"));
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Thử lại" }));
  });

  it("moves focus to Tiếp tục when the gift pauses on a hidden page", async () => {
    const user = userEvent.setup();
    render(<GiftViewer source={{ kind: "ready", viewer: staticViewer() }} />);
    await user.click(screen.getByRole("button", { name: "Mở quà" }));

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tiếp tục" }));
  });

  it("offers Thử lại after a failed deferred load", async () => {
    const user = userEvent.setup();
    const load = vi
      .fn<() => Promise<ViewerPayload>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(staticViewer());
    render(<GiftViewer source={{ kind: "deferred", load }} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Chưa mở được món quà. Hãy kiểm tra kết nối và thử lại.",
    );
    expect(document.body.textContent).not.toContain("Đà Lạt");

    await user.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("region", { name: "Nội dung món quà" })).toBeTruthy();
  });

  it("toggles mute with aria-pressed after opening", async () => {
    const user = userEvent.setup();
    const onMutedChange = vi.fn();
    render(
      <GiftViewer
        onMutedChange={onMutedChange}
        source={{ kind: "ready", viewer: staticViewer() }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Tắt tiếng" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Mở quà" }));
    const mute = screen.getByRole("button", { name: "Tắt tiếng" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    await user.click(mute);

    const unmute = screen.getByRole("button", { name: "Bật tiếng" });
    expect(unmute.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("audio")?.muted).toBe(true);
    expect(onMutedChange).toHaveBeenCalledWith(true);
  });

  it("renders markup in the static fallback as text only", async () => {
    const user = userEvent.setup();
    const markup = "<img src=x onerror=alert(1)>";
    render(
      <GiftViewer
        source={{
          kind: "ready",
          viewer: staticViewer({ payload: { ...completeContent(), "receiver-name": markup } }),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mở quà" }));

    const region = screen.getByRole("region", { name: "Nội dung món quà" });
    expect(region.textContent).toContain(markup);
    expect(region.textContent).toContain("14/02/2023");
    expect(region.textContent).toContain("Đà Lạt 2023 🌲");
    expect(region.textContent).toContain("Cảm ơn em\nvì tất cả.");
    expect(document.querySelector('img[src="x"]')).toBeNull();
    const images = [...region.querySelectorAll("img")];
    expect(images).toHaveLength(3);
    expect(images.every((image) => image.getAttribute("referrerpolicy") === "no-referrer")).toBe(
      true,
    );
    expect(document.activeElement?.textContent).toBe("Nội dung món quà");
  });

  it("shows no mute control for a gift without music", async () => {
    const user = userEvent.setup();
    render(<GiftViewer source={{ kind: "ready", viewer: staticViewer({ audioUrl: null }) }} />);

    await user.click(screen.getByRole("button", { name: "Mở quà" }));

    expect(screen.queryByRole("button", { name: "Tắt tiếng" })).toBeNull();
    expect(document.querySelector("audio")?.getAttribute("src")).toBeNull();
  });
});
