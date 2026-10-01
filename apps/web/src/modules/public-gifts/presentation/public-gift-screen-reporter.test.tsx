import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type GiftViewerProps } from "@/modules/viewer/presentation/gift-viewer";

const fakeViewer = vi.hoisted(() => ({ handlers: [] as GiftViewerProps["onLifecycleEvent"][] }));

vi.mock("@/modules/viewer/presentation/gift-viewer", () => ({
  GiftViewer: function FakeGiftViewer(props: GiftViewerProps) {
    fakeViewer.handlers.push(props.onLifecycleEvent);
    return <div data-testid="gift-viewer" />;
  },
}));

import { PublicGiftScreen } from "./public-gift-screen";

const shareId = "Ab0_-cdefghijklmnopqrs";
const analytics = { giftRef: "Q".repeat(43), templateId: "memory-box", templateVersion: "1.1.0" };

describe("PublicGiftScreen recipient reporter identity", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    window.sessionStorage.clear();
    fakeViewer.handlers = [];
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function eventNames(): string[] {
    return fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(init?.body as string) as { name: string }).name,
    );
  }

  it("keeps the reporter when the page re-renders with an equal analytics object", () => {
    const { rerender } = render(<PublicGiftScreen analytics={analytics} shareId={shareId} />);
    const first = fakeViewer.handlers.at(-1);
    act(() => first?.({ type: "opened" }));

    rerender(<PublicGiftScreen analytics={{ ...analytics }} shareId={shareId} />);
    const second = fakeViewer.handlers.at(-1);
    expect(second).toBe(first);
    act(() => {
      second?.({ type: "opened" });
      second?.({ sceneId: "opening", type: "scene" });
      second?.({ type: "completed" });
    });

    expect(eventNames()).toEqual(["gift_open_interaction", "scene_completed", "gift_completed"]);
  });

  it("makes a new reporter for another gift", () => {
    const { rerender } = render(<PublicGiftScreen analytics={analytics} shareId={shareId} />);
    const first = fakeViewer.handlers.at(-1);
    rerender(
      <PublicGiftScreen analytics={{ ...analytics, giftRef: "Z".repeat(43) }} shareId={shareId} />,
    );
    expect(fakeViewer.handlers.at(-1)).not.toBe(first);
  });
});
