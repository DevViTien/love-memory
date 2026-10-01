import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type AnchorHTMLAttributes,
  type Dispatch,
  type SetStateAction,
  Suspense,
  use,
  useEffect,
  useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";
import { type GiftViewerProps } from "@/modules/viewer/presentation/gift-viewer";
import { viewerPayload } from "@/modules/viewer/test/viewer-fixtures";

const refresh = vi.hoisted(() => vi.fn());
const fakeViewer = vi.hoisted(() => ({
  inits: [] as Array<Readonly<{ forceReducedMotion: boolean; viewer: unknown }>>,
  latest: null as GiftViewerProps | null,
  mounts: 0,
  /** The latest props of each mount, in mount order. */
  props: [] as GiftViewerProps[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/modules/viewer/presentation/gift-viewer", () => ({
  GiftViewer: function FakeGiftViewer(props: GiftViewerProps) {
    const [mount] = useState(() => fakeViewer.props.length);
    fakeViewer.props[mount] = props;
    fakeViewer.latest = props;
    useEffect(() => {
      // One mount is one template initialization.
      fakeViewer.mounts += 1;
      fakeViewer.inits.push({
        forceReducedMotion: props.forceReducedMotion ?? false,
        viewer: props.source.kind === "ready" ? props.source.viewer : null,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="gift-viewer" />;
  },
}));

import { PreviewScreen } from "./preview-screen";

const publicId = "q1w2e3r4t5y6u7i8";
/** The fixtures' build time: their asset URLs expire 300 s later. */
const BUILT_AT = new Date("2026-10-01T10:00:00.000Z");
/** 30 s before the fixtures' URLs expire: a restart must re-read the draft. */
const NEAR_EXPIRY = new Date("2026-10-01T10:04:30.000Z");

type PageState = Readonly<{ hold: Promise<void> | null; viewer: ViewerPayload }>;

/**
 * Stands in for the App Router: `router.refresh()` suspends the page inside the caller's
 * transition until `deliver` answers, with a new payload or (a failed re-read) without one.
 */
const page = {
  release: () => {},
  setState: null as Dispatch<SetStateAction<PageState>> | null,
};

function Page({ initial }: Readonly<{ initial: ViewerPayload }>) {
  const [state, setState] = useState<PageState>({ hold: null, viewer: initial });
  useEffect(() => {
    page.setState = setState;
  }, []);
  if (state.hold) use(state.hold);
  return <PreviewScreen canEdit publicId={publicId} viewer={state.viewer} />;
}

function renderScreen(viewer: ViewerPayload = viewerPayload(), canEdit = true) {
  const props = { canEdit, publicId, viewer };
  const result = render(<PreviewScreen {...props} />);
  return {
    ...result,
    rerenderWith: (next: ViewerPayload) => {
      result.rerender(<PreviewScreen {...props} viewer={next} />);
    },
  };
}

function renderPage(viewer: ViewerPayload = viewerPayload()) {
  refresh.mockImplementation(() => {
    const hold = new Promise<void>((resolve) => {
      page.release = resolve;
    });
    page.setState?.((current) => ({ ...current, hold }));
  });
  render(
    <Suspense fallback={null}>
      <Page initial={viewer} />
    </Suspense>,
  );
}

/** A press that starts a transition the page suspends: inside an awaited `act`. */
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

async function deliver(next?: ViewerPayload) {
  await act(async () => {
    page.release();
    page.setState?.((current) => ({ hold: null, viewer: next ?? current.viewer }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function restartButton() {
  return screen.getByRole("button", { name: /phát lại/i });
}

function motionButton() {
  return screen.getByRole("button", { name: /Giảm chuyển động|Đang áp dụng/ });
}

/** The frame overlay, or `null`; while it shows, the polite status says the same. */
function loadingOverlay() {
  const overlay = document.querySelector("[data-preview-loading]");
  const announced = screen
    .getAllByRole("status")
    .some((status) => status.textContent === "Đang tải lại bản xem trước…");
  expect(announced).toBe(overlay !== null);
  if (overlay) expect(overlay.textContent).toBe("Đang tải lại bản xem trước…");
  return overlay;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BUILT_AT);
  refresh.mockReset();
  fakeViewer.inits = [];
  fakeViewer.latest = null;
  fakeViewer.mounts = 0;
  fakeViewer.props = [];
  page.setState = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PreviewScreen", () => {
  it("switches to the desktop viewport without re-initializing the template", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    const phone = screen.getByRole("button", { name: "Điện thoại" });
    expect(phone.getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Máy tính" }));

    expect(screen.getByRole("button", { name: "Máy tính" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(phone.getAttribute("aria-pressed")).toBe("false");
    const frame = container.querySelector("[data-viewport]");
    expect(frame?.getAttribute("data-viewport")).toBe("desktop");
    expect(frame?.className).toContain("aspect-[16/10]");
    expect(fakeViewer.mounts).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("restarts in the browser with the held payload while its URLs stay valid", async () => {
    const user = userEvent.setup();
    const viewer = viewerPayload();
    renderScreen(viewer);
    vi.setSystemTime(new Date(BUILT_AT.getTime() + 60_000));

    await user.click(screen.getByRole("button", { name: "Phát lại" }));

    expect(refresh).not.toHaveBeenCalled();
    expect(fakeViewer.mounts).toBe(2);
    expect(fakeViewer.inits[1]?.viewer).toBe(viewer);
    expect(fakeViewer.inits[1]?.forceReducedMotion).toBe(false);
  });

  it("shows the busy control and the frame overlay until the new runtime is ready", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(loadingOverlay()).toBeNull();
    // No hidden spinner keeps animating while idle.
    expect(document.querySelectorAll('[class*="animate-spin"]')).toHaveLength(0);

    await user.click(restartButton());
    expect(document.querySelectorAll('[class*="animate-spin"]').length).toBeGreaterThan(0);

    const busy = screen.getByRole("button", { name: "Đang phát lại…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(busy);
    expect(motionButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Máy tính" }).hasAttribute("disabled")).toBe(false);
    expect(loadingOverlay()).toBeTruthy();
    const live = screen
      .getAllByRole("status")
      .find((status) => status.textContent === "Đang tải lại bản xem trước…");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("gift-viewer").parentElement?.hasAttribute("inert")).toBe(true);

    // The gift viewer being replaced never ends the restart.
    act(() => fakeViewer.props[0]?.onRuntimeSettled?.("ready"));
    expect(loadingOverlay()).toBeTruthy();
    act(() => fakeViewer.props[1]?.onRuntimeSettled?.("ready"));

    const idle = screen.getByRole("button", { name: "Phát lại" });
    expect(idle.hasAttribute("aria-busy")).toBe(false);
    expect(idle.hasAttribute("aria-disabled")).toBe(false);
    expect(motionButton().hasAttribute("disabled")).toBe(false);
    expect(loadingOverlay()).toBeNull();
    expect(screen.getByTestId("gift-viewer").parentElement?.hasAttribute("inert")).toBe(false);
    expect(document.querySelectorAll('[class*="animate-spin"]')).toHaveLength(0);
  });

  it("restarts once when the control is pressed repeatedly", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(restartButton());
    await user.click(restartButton());
    await user.click(restartButton());

    expect(fakeViewer.mounts).toBe(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ends the pending state when the new runtime falls back", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(restartButton());
    act(() => {
      fakeViewer.props[1]?.onLifecycleEvent?.({ reason: "INIT_TIMEOUT", type: "fallback" });
      fakeViewer.props[1]?.onRuntimeSettled?.("fallback");
    });

    expect(loadingOverlay()).toBeNull();
    expect(
      screen.getByText(
        "Đang hiển thị bản tĩnh vì mẫu quà không chạy được. Người nhận vẫn thấy đầy đủ nội dung.",
      ),
    ).toBeTruthy();
  });

  it("re-reads the draft near URL expiry and remounts with the fresh payload", async () => {
    const user = userEvent.setup();
    renderPage();
    vi.setSystemTime(NEAR_EXPIRY);

    await press(restartButton());
    expect(refresh).toHaveBeenCalledOnce();
    expect(fakeViewer.mounts).toBe(1);
    expect(screen.getByRole("button", { name: "Đang phát lại…" })).toBeTruthy();
    expect(loadingOverlay()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Đang phát lại…" }));
    expect(refresh).toHaveBeenCalledOnce();

    const fresh = viewerPayload({ payload: { "receiver-name": "Bình" } });
    await deliver(fresh);

    expect(fakeViewer.mounts).toBe(2);
    expect(fakeViewer.inits[1]?.viewer).toBe(fresh);
    expect(loadingOverlay()).toBeTruthy();
    act(() => fakeViewer.props[1]?.onRuntimeSettled?.("ready"));
    expect(loadingOverlay()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a re-read that ends without a new payload and keeps the running gift", async () => {
    const user = userEvent.setup();
    renderPage();
    vi.setSystemTime(NEAR_EXPIRY);

    await press(motionButton());
    expect(motionButton().getAttribute("aria-pressed")).toBe("true");
    await deliver();

    expect(fakeViewer.mounts).toBe(1);
    expect(loadingOverlay()).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "Chưa tải lại được bản xem trước. Hãy thử lại.",
    );
    expect(motionButton().getAttribute("aria-pressed")).toBe("false");
    expect(motionButton().hasAttribute("aria-busy")).toBe(false);

    // The next restart clears the message.
    vi.setSystemTime(BUILT_AT);
    await user.click(restartButton());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restarts with forced reduced motion from the toggle", async () => {
    const user = userEvent.setup();
    renderScreen();
    const toggle = screen.getByRole("button", { name: "Giảm chuyển động" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Đang áp dụng…" })).toBe(toggle);
    expect(restartButton().hasAttribute("disabled")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(fakeViewer.mounts).toBe(2);
    expect(fakeViewer.inits[1]?.forceReducedMotion).toBe(true);
  });

  it("re-reads the draft for the reduced-motion toggle near URL expiry", async () => {
    renderPage();
    vi.setSystemTime(NEAR_EXPIRY);

    await press(motionButton());
    expect(refresh).toHaveBeenCalledOnce();
    await deliver(viewerPayload());

    expect(fakeViewer.mounts).toBe(2);
    expect(fakeViewer.inits[1]?.forceReducedMotion).toBe(true);
  });

  it("refreshes expired asset URLs without remounting the gift", () => {
    const { rerenderWith } = renderScreen();

    act(() => fakeViewer.latest?.onAssetsExpired?.());
    expect(refresh).toHaveBeenCalledOnce();
    const fresh = viewerPayload({ assets: {} });
    rerenderWith(fresh);

    expect(fakeViewer.mounts).toBe(1);
    expect(fakeViewer.latest?.source).toEqual({ kind: "ready", viewer: fresh });
  });

  it("keeps the muted state across a restart", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderScreen();

    act(() => fakeViewer.latest?.onMutedChange?.(true));
    await user.click(screen.getByRole("button", { name: "Phát lại" }));
    rerenderWith(viewerPayload());

    expect(fakeViewer.latest?.muted).toBe(true);
  });

  it("shows the private-link and no-artifact notices for memory-box 1.0.0", () => {
    renderScreen(
      viewerPayload({
        artifactUrl: null,
        issues: [{ code: "CONTENT_MISSING", fieldId: "final-letter" }],
      }),
    );

    expect(
      screen.getByText(
        "Liên kết xem trước riêng tư, hết hạn sau 30 phút. Đừng chia sẻ liên kết này.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Phiên bản mẫu của bản nháp này không hỗ trợ xem trước hiệu ứng."),
    ).toBeTruthy();
    expect(screen.getByText("Lá thư cuối: chưa có nội dung.")).toBeTruthy();
    act(() => fakeViewer.latest?.onLifecycleEvent?.({ reason: "NO_ARTIFACT", type: "fallback" }));
    expect(screen.queryByText(/Mẫu quà gặp lỗi khi hiển thị/)).toBeNull();
    expect(screen.queryByText(/Đang hiển thị bản tĩnh/)).toBeNull();
  });

  it("shows the template-error notices after a runtime failure until the next restart", async () => {
    const user = userEvent.setup();
    renderScreen();

    act(() => fakeViewer.latest?.onLifecycleEvent?.({ reason: "ERROR", type: "fallback" }));

    expect(
      screen.getByText(
        "Mẫu quà gặp lỗi khi hiển thị. Người nhận sẽ thấy bản tĩnh với đầy đủ nội dung.",
      ),
    ).toBeTruthy();
    const frameNotice = screen.getByText(
      "Đang hiển thị bản tĩnh vì mẫu quà không chạy được. Người nhận vẫn thấy đầy đủ nội dung.",
    );
    expect(frameNotice.getAttribute("role")).toBe("status");

    await user.click(restartButton());
    expect(screen.queryByText(/Đang hiển thị bản tĩnh/)).toBeNull();
    expect(screen.queryByText(/Mẫu quà gặp lỗi khi hiển thị/)).toBeNull();
  });

  it("links each issue to its Studio field, merging template issues", () => {
    renderScreen(viewerPayload({ issues: [{ code: "CONTENT_MISSING", fieldId: "final-letter" }] }));

    act(() =>
      fakeViewer.latest?.onIssuesChange?.([
        { code: "CONTENT_MISSING", fieldId: "final-letter" },
        { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 0 },
      ]),
    );

    const links = screen.getAllByRole("link", { name: "Sửa" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/studio/${publicId}?field=memories`,
      `/studio/${publicId}?field=final-letter`,
    ]);
    expect(screen.getByRole("link", { name: "Quay lại chỉnh sửa" }).getAttribute("href")).toBe(
      `/studio/${publicId}?step=preview`,
    );
    expect(screen.queryByText("Mở Studio trên thiết bị đã tạo quà để sửa.")).toBeNull();
  });

  it("offers no edit links on a device that cannot edit", () => {
    renderScreen(
      viewerPayload({ issues: [{ code: "CONTENT_MISSING", fieldId: "receiver-name" }] }),
      false,
    );

    expect(screen.getByText("Tên người nhận: chưa có nội dung.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sửa" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Quay lại chỉnh sửa" })).toBeNull();
    expect(screen.getByText("Mở Studio trên thiết bị đã tạo quà để sửa.")).toBeTruthy();
  });

  it("reports a complete gift", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Cần hoàn thiện" })).toBeTruthy();
    expect(screen.getByText("Không phát hiện vấn đề nào.")).toBeTruthy();
  });
});

describe("PreviewScreen funnel analytics", () => {
  it("sends no /api/events request while the gift plays to its end (Preview never reports recipient events)", () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderScreen();
      act(() => {
        fakeViewer.latest?.onLifecycleEvent?.({ type: "opened" });
        for (const sceneId of ["opening", "memory-1", "memory-2", "memory-3", "letter", "finale"]) {
          fakeViewer.latest?.onLifecycleEvent?.({ sceneId, type: "scene" });
        }
        fakeViewer.latest?.onLifecycleEvent?.({ type: "completed" });
      });

      expect(fetchMock.mock.calls.some(([input]) => input === "/api/events")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
