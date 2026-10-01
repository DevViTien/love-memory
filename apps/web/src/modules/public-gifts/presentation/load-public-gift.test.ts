import { describe, expect, it, vi } from "vitest";

import { viewerPayload } from "@/modules/viewer/test/viewer-fixtures";

import { loadPublicGift } from "./load-public-gift";

const shareId = "Ab0_-cdefghijklmnopqrs";

function recipientViewer() {
  const { issues: _issues, ...viewer } = viewerPayload();
  return viewer;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("loadPublicGift", () => {
  it("fetches the payload without credentials or caching and returns the viewer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ data: { viewer: recipientViewer() } })),
    );

    await expect(loadPublicGift(fetchImpl, shareId)).resolves.toEqual(recipientViewer());
    expect(fetchImpl).toHaveBeenCalledWith(`/api/public-gifts/${shareId}`, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
  });

  it.each([404, 429, 500])("throws for status %s", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ error: { code: "X" } }, status)),
    );

    await expect(loadPublicGift(fetchImpl, shareId)).rejects.toThrow(String(status));
  });

  it("throws for a body with creator issues", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ data: { viewer: viewerPayload() } })),
    );

    await expect(loadPublicGift(fetchImpl, shareId)).rejects.toThrow(
      "The public gift response is invalid.",
    );
  });

  it("propagates a network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));

    await expect(loadPublicGift(fetchImpl, shareId)).rejects.toThrow("offline");
  });
});
