import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as StudioFunnelModule from "@/modules/analytics/presentation/studio-funnel";

import { assetIds, draftGift, jsonResponse } from "./studio/test/fixtures";
import {
  analyticsEventNames,
  editorElement,
  patchBodies,
  readyAsset,
  renderEditor,
  setStudioUrl,
  stubStudioFetch,
  studioAnalytics,
  urlOf,
} from "./studio/test/render-editor";

const funnelSpies = vi.hoisted(() => ({ track: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/modules/analytics/presentation/studio-funnel", async (importOriginal) => {
  const actual = await importOriginal<typeof StudioFunnelModule>();
  return {
    trackStudioFunnel: (input: Parameters<typeof actual.trackStudioFunnel>[0]) => {
      funnelSpies.track(input);
      const stop = actual.trackStudioFunnel(input);
      return () => {
        funnelSpies.unsubscribe();
        stop();
      };
    },
  };
});

vi.mock("next/navigation", () => import("./studio/test/next-navigation"));
vi.mock("@/modules/media/presentation/image-crop", () => ({
  cropImageToAspectRatio: (file: File) => Promise.resolve(file),
}));

function leavePage(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function nameInput() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setStudioUrl();
});

describe("DraftEditor unsaved-changes warning", () => {
  it("asks before leaving with unsaved changes", async () => {
    stubStudioFetch();
    const user = userEvent.setup();
    renderEditor();

    await user.type(nameInput(), "Linh");

    expect(leavePage()).toBe(true);
  });

  it("does not ask after a save", async () => {
    stubStudioFetch();
    const user = userEvent.setup();
    renderEditor();
    expect(leavePage()).toBe(false);

    await user.type(nameInput(), "Linh");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Đã lưu"));
    expect(leavePage()).toBe(false);
  });

  it("does not ask for a draft whose stored content is invalid", () => {
    stubStudioFetch();
    renderEditor({ content: { audio: "old-piano" } });

    expect(screen.getByRole("status").textContent).toContain("Chưa lưu được: Nhạc nền");
    expect(leavePage()).toBe(false);
  });

  it("asks before leaving with an unsent invalid edit", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ content: { audio: "old-piano" } });

    await user.type(nameInput(), "Linh");

    expect(leavePage()).toBe(true);
    expect(patchBodies(fetchMock)).toHaveLength(0);
  });
});

describe("DraftEditor background saves", () => {
  it("sends a pending change at once when the page becomes hidden", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor();
    await user.type(nameInput(), "Linh");

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(patchBodies(fetchMock)).toEqual([
      { content: { "receiver-name": "Linh" }, expectedRevision: 0 },
    ]);
    const init = fetchMock.mock.calls.find(([, request]) => request?.method === "PATCH")?.[1];
    expect(init?.keepalive).toBe(true);
  });

  it("sends a pending change at once on pagehide", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor();
    await user.type(nameInput(), "Linh");

    window.dispatchEvent(new Event("pagehide"));

    expect(patchBodies(fetchMock)).toEqual([
      { content: { "receiver-name": "Linh" }, expectedRevision: 0 },
    ]);
  });

  it("sends edits typed during a save in flight when the editor unmounts", async () => {
    let finishFirstSave: (() => void) | undefined;
    const fetchMock = stubStudioFetch({
      patch: (body) => {
        const response = jsonResponse({
          data: { gift: draftGift(body.content, { revision: body.expectedRevision + 1 }) },
        });
        if (finishFirstSave !== undefined || body.expectedRevision > 0) return response;
        return new Promise<Response>((resolve) => {
          finishFirstSave = () => resolve(response);
        });
      },
    });
    const user = userEvent.setup();
    const { unmount } = renderEditor();
    await user.type(nameInput(), "Linh");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));
    await user.type(nameInput(), " ơi");

    unmount();
    finishFirstSave?.();

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(2));
    expect(patchBodies(fetchMock)[1]).toEqual({
      content: { "receiver-name": "Linh ơi" },
      expectedRevision: 1,
    });
  });

  it("sends a pending change when the editor unmounts", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    const { unmount } = renderEditor();
    await user.type(nameInput(), "Linh");

    unmount();

    expect(patchBodies(fetchMock)).toHaveLength(1);
  });

  it("reports offline and saves when the browser is back online", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderEditor();

    window.dispatchEvent(new Event("offline"));
    await user.type(nameInput(), "Linh");
    expect(screen.getByRole("status").textContent).toBe("Mất kết nối — sẽ lưu khi có mạng");

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Đã lưu"));
    expect(patchBodies(fetchMock)).toHaveLength(1);
  });
});

describe("DraftEditor image fields", () => {
  it("renders a captioned image field seeded with the saved captions", async () => {
    stubStudioFetch({ assets: [readyAsset(assetIds[0])] });
    setStudioUrl("?step=memories");
    renderEditor({
      content: { memories: [{ assetId: assetIds[0], caption: "Lần đầu gặp nhau" }] },
    });

    expect((await screen.findByLabelText<HTMLInputElement>("Chú thích ảnh 1")).value).toBe(
      "Lần đầu gặp nhau",
    );
    expect(screen.getByText("1/8 ảnh")).toBeTruthy();
    expect(screen.getByText("Cần thêm 2 ảnh")).toBeTruthy();
  });

  it("autosaves a new image order without any save action", async () => {
    const fetchMock = stubStudioFetch({ assets: [readyAsset(assetIds[0])] });
    renderEditor();

    await waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1), { timeout: 5000 });
    expect(patchBodies(fetchMock)[0]).toEqual({
      content: { memories: [{ assetId: assetIds[0] }] },
      expectedRevision: 0,
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Đã lưu"));
    // Waits for the real 1.5 s autosave debounce, which needs headroom under a loaded coverage run.
  }, 15_000);

  it("keeps an upload running while the creator moves to another step", async () => {
    const requests: Array<{ abort: ReturnType<typeof vi.fn> }> = [];
    class PendingUpload extends EventTarget {
      readonly abort = vi.fn();
      readonly upload = new EventTarget();
      constructor() {
        super();
        requests.push(this);
      }
      open() {}
      send() {}
      setRequestHeader() {}
    }
    vi.stubGlobal("XMLHttpRequest", PendingUpload);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:crop-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const fetchMock = stubStudioFetch();
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      urlOf(input) === "/api/media/uploads/init"
        ? Promise.resolve(
            jsonResponse(
              {
                data: {
                  assetId: assetIds[0],
                  expiresAt: "2026-10-01T00:10:00.000Z",
                  headers: { "content-type": "image/jpeg" },
                  method: "PUT",
                  url: "https://blob.example/upload",
                },
              },
              201,
            ),
          )
        : defaultFetch(input, init),
    );
    const user = userEvent.setup();
    setStudioUrl("?step=memories");
    renderEditor();

    const file = new File([Uint8Array.from([1, 2, 3])], "memory.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Chọn ảnh"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Dùng vùng ảnh này" }));
    await waitFor(() => expect(requests).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Quay lại" }));
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(requests[0]?.abort).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Chọn ảnh")).toBeTruthy();
  });
});

describe("DraftEditor funnel analytics", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    funnelSpies.track.mockClear();
    funnelSpies.unsubscribe.mockClear();
  });

  it("subscribes the funnel tracker, sends customization_started on the first save and disposes it on unmount", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    const { unmount } = renderEditor({ analytics: studioAnalytics });
    expect(funnelSpies.track).toHaveBeenCalledTimes(1);

    await user.type(nameInput(), "Linh");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));
    await waitFor(() => expect(analyticsEventNames(fetchMock)).toEqual(["customization_started"]));
    const [, init] = fetchMock.mock.calls.find(([input]) => urlOf(input) === "/api/events")!;
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("strict-origin");

    unmount();
    expect(funnelSpies.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps the tracker when the page re-renders with an equal analytics object", () => {
    stubStudioFetch();
    const { rerender } = render(editorElement({ analytics: studioAnalytics }));
    rerender(editorElement({ analytics: { ...studioAnalytics } }));

    expect(funnelSpies.track).toHaveBeenCalledTimes(1);
    expect(funnelSpies.unsubscribe).not.toHaveBeenCalled();
  });

  it("sends no request to /api/events when analytics is null", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    renderEditor({ analytics: null });

    await user.type(nameInput(), "Linh");
    await user.click(screen.getByRole("button", { name: "Lưu ngay" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Đã lưu"));
    expect(analyticsEventNames(fetchMock)).toEqual([]);
  });
});
