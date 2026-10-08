import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PreviewActionModule from "./preview-action";
import { apiError, assetIds, jsonResponse } from "./test/fixtures";
import {
  analyticsEventNames,
  renderEditor,
  setStudioUrl,
  stubStudioFetch,
  studioAnalytics,
  urlOf,
  studioPhotos,
} from "./test/render-editor";

const previewMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("next/navigation", () => import("./test/next-navigation"));
vi.mock("./preview-action", async (importOriginal) => ({
  ...(await importOriginal<typeof PreviewActionModule>()),
  navigateToPreview: previewMocks.navigate,
}));

const completeContent = {
  "final-letter": "Anh nhớ em.",
  memories: assetIds.map((assetId) => ({ assetId })),
  "opening-message": "Mở hộp nhé",
  "receiver-name": "Linh",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Readiness steps", () => {
  it("lists incomplete steps with Sửa links that open them", async () => {
    stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor({ content: { "opening-message": "Mở hộp nhé", "receiver-name": "Linh" } });

    const items = screen.getAllByRole("listitem").filter((item) => item.closest("section"));
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual(["Kỷ niệm", "Lá thư"]);

    await user.click(within(items[1]!).getByRole("link", { name: "Sửa" }));

    expect(window.location.search).toBe("?step=letter");
    expect(screen.getByRole("heading", { name: "Lá thư" })).toBeTruthy();
    expect(document.activeElement?.id).toBe("studio-step-letter");
  });

  it("shows every step ready and the action disabled while no plan fits (Action not yet available)", async () => {
    const photos = studioPhotos(5);
    const fetchMock = stubStudioFetch({ assets: photos.assets });
    setStudioUrl("?step=publish");
    renderEditor({
      content: { ...completeContent, memories: photos.memories },
      ownerKind: "user",
      signedIn: true,
    });
    await screen.findAllByText("5/8 ảnh");

    const step = within(screen.getByRole("region", { name: "Xuất bản" }));
    expect(step.getByText("Tất cả các bước đã sẵn sàng.")).toBeTruthy();
    expect(step.getByText("Món quà đang có 5 ảnh, gói này cho tối đa 3 ảnh.")).toBeTruthy();
    expect(step.getByText("Sắp mở thanh toán.")).toBeTruthy();
    expect(step.getByRole<HTMLButtonElement>("button", { name: "Xuất bản" }).disabled).toBe(true);
    expect(step.getByText("Chọn một gói để xuất bản.")).toBeTruthy();
    expect(step.queryByText("Sắp ra mắt")).toBeNull();
    expect(
      fetchMock.mock.calls.every(([input]) => urlOf(input).startsWith("/api/media/assets?")),
    ).toBe(true);
  });

  it("sends no request when the preview step opens", async () => {
    const fetchMock = stubStudioFetch();
    const user = userEvent.setup();
    setStudioUrl();
    renderEditor();

    await user.click(screen.getByRole("button", { name: /^6\. Xem trước/ }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Xem trước" }).disabled).toBe(
      false,
    );
    expect(
      fetchMock.mock.calls.every(([input]) => urlOf(input).startsWith("/api/gifts/") === false),
    ).toBe(true);
  });
});

describe("Xem trước action", () => {
  const previewUrl = `/preview/${"A-_b".repeat(10)}xyz`;

  function previewCreated() {
    return jsonResponse({ data: { expiresAt: "2026-10-01T10:30:00.000Z", url: previewUrl } }, 201);
  }

  function previewPosts(fetchMock: ReturnType<typeof stubStudioFetch>) {
    return fetchMock.mock.calls.filter(
      ([input, init]) => urlOf(input).endsWith("/preview") && init?.method === "POST",
    );
  }

  function requestOrder(fetchMock: ReturnType<typeof stubStudioFetch>) {
    return fetchMock.mock.calls
      .filter(([input]) => urlOf(input).startsWith("/api/gifts/"))
      .map(([input, init]) => `${init?.method} ${urlOf(input)}`);
  }

  beforeEach(() => {
    previewMocks.navigate.mockReset();
  });

  it("saves a pending change first, then opens one preview link in this tab", async () => {
    const fetchMock = stubStudioFetch({ preview: () => previewCreated() });
    const user = userEvent.setup();
    setStudioUrl("?step=recipient");
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(screen.getByRole("button", { name: /^6\. Xem trước/ }));
    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    await waitFor(() => expect(previewMocks.navigate).toHaveBeenCalledWith(previewUrl));
    expect(requestOrder(fetchMock)).toEqual([
      "PATCH /api/gifts/q1w2e3r4t5y6u7i8",
      "POST /api/gifts/q1w2e3r4t5y6u7i8/preview",
    ]);
    const [, init] = previewPosts(fetchMock)[0]!;
    expect(init?.body).toBe("{}");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Đang mở bản xem trước…" }).disabled,
    ).toBe(true);
  });

  it("sends preview_started before navigating to the preview link", async () => {
    window.sessionStorage.clear();
    const fetchMock = stubStudioFetch({ preview: () => previewCreated() });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor({ analytics: studioAnalytics });

    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    await waitFor(() => expect(previewMocks.navigate).toHaveBeenCalledWith(previewUrl));
    expect(analyticsEventNames(fetchMock)).toEqual(["preview_started"]);
    const eventCall = fetchMock.mock.calls.findIndex(([input]) => urlOf(input) === "/api/events");
    expect(fetchMock.mock.calls[eventCall]?.[1]?.keepalive).toBe(true);
  });

  it("opens the preview of an incomplete, saved draft", async () => {
    const fetchMock = stubStudioFetch({ preview: () => previewCreated() });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor({ content: { "receiver-name": "Linh" } });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    await waitFor(() => expect(previewMocks.navigate).toHaveBeenCalledWith(previewUrl));
    expect(previewPosts(fetchMock)).toHaveLength(1);
  });

  it("sends no preview request while the content has a client-side error", async () => {
    const fetchMock = stubStudioFetch({ preview: () => previewCreated() });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor({ content: { audio: "old-piano" } });

    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Xem trước" }).disabled).toBe(
        false,
      ),
    );
    expect(previewPosts(fetchMock)).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain("Chưa lưu được");
    expect(previewMocks.navigate).not.toHaveBeenCalled();
  });

  it("sends no preview request during an unresolved conflict", async () => {
    const fetchMock = stubStudioFetch({
      patch: () =>
        jsonResponse(
          apiError("CONFLICT", { details: { actualRevision: 5, expectedRevision: 0 } }),
          409,
        ),
      preview: () => previewCreated(),
    });
    const user = userEvent.setup();
    setStudioUrl("?step=recipient");
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(screen.getByRole("button", { name: /^6\. Xem trước/ }));
    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    expect((await screen.findByRole("alert")).textContent).toContain("phiên bản 5");
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Xem trước" }).disabled).toBe(
        false,
      ),
    );
    expect(previewPosts(fetchMock)).toHaveLength(0);
  });

  it("sends no preview request while offline", async () => {
    const fetchMock = stubStudioFetch({ preview: () => previewCreated() });
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    setStudioUrl("?step=recipient");
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Tên người nhận" }), "Linh");
    await user.click(screen.getByRole("button", { name: /^6\. Xem trước/ }));
    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Mất kết nối"));
    expect(previewPosts(fetchMock)).toHaveLength(0);
    onLine.mockRestore();
  });

  it("stays on the page and explains a rate limit", async () => {
    stubStudioFetch({
      preview: () =>
        jsonResponse(apiError("RATE_LIMITED", { details: { retryAfterSeconds: 120 } }), 429),
    });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    expect(
      (
        await screen.findByText("Bạn mở xem trước quá nhiều lần. Hãy thử lại sau 120 giây.")
      ).getAttribute("role"),
    ).toBe("alert");
    expect(previewMocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Xem trước" }).disabled).toBe(
      false,
    );
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 500", () => jsonResponse(apiError("INTERNAL_ERROR"), 500)],
  ])("stays on the page with the content after %s", async (_name, preview) => {
    stubStudioFetch({ preview });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor({ content: { "receiver-name": "Linh" } });

    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    expect(await screen.findByText("Chưa mở được bản xem trước — thử lại.")).toBeTruthy();
    expect(previewMocks.navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^1\. Người nhận/ }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tên người nhận" }).value).toBe(
      "Linh",
    );
  });

  it("shows the non-editable alert when the draft is gone", async () => {
    stubStudioFetch({ preview: () => jsonResponse(apiError("NOT_FOUND"), 404) });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Xem trước" }));

    expect(
      await screen.findByText("Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang."),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Lưu ngay" }).disabled).toBe(true);
  });

  it("sends one request for a double click", async () => {
    let respond: (response: Response) => void = () => undefined;
    const fetchMock = stubStudioFetch({
      preview: () => new Promise<Response>((resolve) => (respond = resolve)),
    });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor();

    await user.dblClick(screen.getByRole("button", { name: "Xem trước" }));

    await waitFor(() => expect(previewPosts(fetchMock)).toHaveLength(1));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Đang mở bản xem trước…" }).disabled,
    ).toBe(true);
    respond(previewCreated());
    await waitFor(() => expect(previewMocks.navigate).toHaveBeenCalledOnce());
    expect(previewPosts(fetchMock)).toHaveLength(1);
  });

  it("works again after the page returns from the back/forward cache", async () => {
    const fetchMock = stubStudioFetch({ preview: () => previewCreated() });
    const user = userEvent.setup();
    setStudioUrl("?step=preview");
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Xem trước" }));
    await waitFor(() => expect(previewMocks.navigate).toHaveBeenCalledOnce());

    const pageShow = (persisted: boolean) => {
      const event = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", { value: persisted });
      act(() => {
        window.dispatchEvent(event);
      });
    };
    pageShow(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Đang mở bản xem trước…" }).disabled,
    ).toBe(true);
    pageShow(true);

    await user.click(screen.getByRole("button", { name: "Xem trước" }));
    await waitFor(() => expect(previewMocks.navigate).toHaveBeenCalledTimes(2));
    expect(previewPosts(fetchMock)).toHaveLength(2);
  });
});
