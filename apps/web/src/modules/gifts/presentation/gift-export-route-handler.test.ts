import { beforeEach, describe, expect, it, vi } from "vitest";

import { type GiftExport, type GiftExportService } from "../application/gift-export";
import { type GiftAccessor } from "../application/gift-service";
import { type GiftExportRouteDependencies, handleGiftExport } from "./gift-export-route-handler";

const publicId = "q1w2e3r4t5y6u7i8";
const owner: GiftAccessor = { kind: "user", userId: "user-1" };
const exported = { content: { receiver: "Minh Thư" }, photos: [] } as unknown as GiftExport;

function get(id = publicId): [Request, { params: Promise<{ publicId: string }> }] {
  return [
    new Request(`http://localhost:3000/api/gifts/${id}/export`, {
      headers: { "x-request-id": "request-1" },
    }),
    { params: Promise.resolve({ publicId: id }) },
  ];
}

describe("GET /api/gifts/{publicId}/export", () => {
  const exportGift = vi.fn<GiftExportService["export"]>();
  const limit = vi.fn<GiftExportRouteDependencies["limit"]>();
  const dependencies: GiftExportRouteDependencies = {
    getAccessors: () => Promise.resolve([owner]),
    limit,
    service: { export: exportGift },
  };
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue(null);
  });

  it("downloads the export as a no-store JSON attachment (Owner exports a published gift)", async () => {
    exportGift.mockResolvedValueOnce(exported);

    const response = await handleGiftExport(...get(), dependencies);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="love-memory-${publicId}.json"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toEqual(exported);
    expect(exportGift).toHaveBeenCalledWith(publicId, [owner]);
  });

  it("answers 404 for others and malformed ids (Someone else asks for the export)", async () => {
    exportGift.mockResolvedValueOnce(null);
    expect((await handleGiftExport(...get(), dependencies)).status).toBe(404);
    expect((await handleGiftExport(...get("../x"), dependencies)).status).toBe(404);
  });

  it("answers the rate limit before reading, and 500 without logging content", async () => {
    limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await handleGiftExport(...get(), dependencies)).status).toBe(429);
    expect(exportGift).not.toHaveBeenCalled();

    exportGift.mockRejectedValueOnce(new Error("storage down"));
    expect((await handleGiftExport(...get(), dependencies)).status).toBe(500);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("Minh Thư");
  });
});
