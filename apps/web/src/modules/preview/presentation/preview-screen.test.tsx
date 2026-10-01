import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type AnchorHTMLAttributes, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";
import { type GiftViewerProps } from "@/modules/viewer/presentation/gift-viewer";
import { viewerPayload } from "@/modules/viewer/test/viewer-fixtures";

const refresh = vi.hoisted(() => vi.fn());
const fakeViewer = vi.hoisted(() => ({
  inits: [] as Array<Readonly<{ forceReducedMotion: boolean; viewer: unknown }>>,
  latest: null as GiftViewerProps | null,
  mounts: 0,
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

beforeEach(() => {
  refresh.mockReset();
  fakeViewer.inits = [];
  fakeViewer.latest = null;
  fakeViewer.mounts = 0;
});

afterEach(() => {
  cleanup();
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

  it("restarts with fresh content once the refreshed payload arrives", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderScreen();

    await user.click(screen.getByRole("button", { name: "Phát lại" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(fakeViewer.mounts).toBe(1);

    const fresh = viewerPayload({ payload: { "receiver-name": "Bình" } });
    rerenderWith(fresh);

    expect(fakeViewer.mounts).toBe(2);
    expect(fakeViewer.inits[1]?.viewer).toBe(fresh);
  });

  it("restarts with forced reduced motion from the toggle", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderScreen();
    const toggle = screen.getByRole("button", { name: "Giảm chuyển động" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(refresh).toHaveBeenCalledOnce();
    rerenderWith(viewerPayload());

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
  });

  it("shows the template-error notice after a runtime failure", () => {
    renderScreen();

    act(() => fakeViewer.latest?.onLifecycleEvent?.({ reason: "ERROR", type: "fallback" }));

    expect(
      screen.getByText(
        "Mẫu quà gặp lỗi khi hiển thị. Người nhận sẽ thấy bản tĩnh với đầy đủ nội dung.",
      ),
    ).toBeTruthy();
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
