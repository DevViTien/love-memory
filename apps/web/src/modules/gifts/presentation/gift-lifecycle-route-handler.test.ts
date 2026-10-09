import { beforeEach, describe, expect, it, vi } from "vitest";

import { type GiftLifecycleService } from "../application/gift-lifecycle";
import { type GiftAccessor } from "../application/gift-service";
import {
  type GiftLifecycleRouteDependencies,
  handleGiftLifecycle,
} from "./gift-lifecycle-route-handler";

const publicId = "q1w2e3r4t5y6u7i8";
const owner: GiftAccessor = { kind: "user", userId: "user-1" };
const context = { params: Promise.resolve({ publicId }) };

function post(action: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/gifts/${publicId}/${action}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-request-id": "request-1",
      ...headers,
    },
    method: "POST",
  });
}

describe("gift lifecycle routes", () => {
  const pause = vi.fn<GiftLifecycleService["pause"]>();
  const resume = vi.fn<GiftLifecycleService["resume"]>();
  const deleteGift = vi.fn<GiftLifecycleService["deleteGift"]>();
  const limit = vi.fn<GiftLifecycleRouteDependencies["limit"]>();
  const dependencies: GiftLifecycleRouteDependencies = {
    getAccessors: () => Promise.resolve([owner]),
    limit,
    service: { deleteGift, pause, resume },
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue(null);
  });

  it("pauses and resumes with 200 (Owner pauses a published gift)", async () => {
    pause.mockResolvedValueOnce({ data: { publicId, status: "paused" }, ok: true });
    const paused = await handleGiftLifecycle("pause", post("pause"), context, dependencies);
    expect(paused.status).toBe(200);
    await expect(paused.json()).resolves.toEqual({
      data: { gift: { publicId, status: "paused" } },
    });
    expect(pause).toHaveBeenCalledWith(publicId, [owner]);

    resume.mockResolvedValueOnce({ data: { publicId, status: "published" }, ok: true });
    const resumed = await handleGiftLifecycle("resume", post("resume"), context, dependencies);
    await expect(resumed.json()).resolves.toMatchObject({
      data: { gift: { status: "published" } },
    });
  });

  it("answers 202 with the deletion status (Owner deletes a published gift)", async () => {
    deleteGift.mockResolvedValueOnce({
      data: {
        purgeBy: "2026-10-11T10:00:00.000Z",
        requestedAt: "2026-10-10T10:00:00.000Z",
        status: "deleting",
      },
      ok: true,
    });

    const response = await handleGiftLifecycle("delete", post("delete"), context, dependencies);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: {
        deletion: {
          purgeBy: "2026-10-11T10:00:00.000Z",
          requestedAt: "2026-10-10T10:00:00.000Z",
          status: "deleting",
        },
      },
    });
  });

  it("maps the service errors to 404 and 409 with their reasons", async () => {
    resume.mockResolvedValueOnce({ error: { code: "GIFT_EXPIRED" }, ok: false });
    const expired = await handleGiftLifecycle("resume", post("resume"), context, dependencies);
    expect(expired.status).toBe(409);
    await expect(expired.json()).resolves.toMatchObject({
      error: { code: "CONFLICT", details: { reason: "GIFT_EXPIRED" } },
    });

    pause.mockResolvedValueOnce({ error: { code: "GIFT_NOT_PUBLISHED" }, ok: false });
    const draft = await handleGiftLifecycle("pause", post("pause"), context, dependencies);
    await expect(draft.json()).resolves.toMatchObject({
      error: { details: { reason: "GIFT_NOT_PUBLISHED" } },
    });

    resume.mockResolvedValueOnce({ error: { code: "GIFT_TAKEN_DOWN" }, ok: false });
    const takenDown = await handleGiftLifecycle("resume", post("resume"), context, dependencies);
    await expect(takenDown.json()).resolves.toMatchObject({
      error: { details: { reason: "GIFT_TAKEN_DOWN" } },
    });

    deleteGift.mockResolvedValueOnce({ error: { code: "NOT_FOUND" }, ok: false });
    const missing = await handleGiftLifecycle("delete", post("delete"), context, dependencies);
    expect(missing.status).toBe(404);
  });

  it("refuses a foreign origin, a bad path, a non-empty body and an exceeded limit before the service", async () => {
    const foreign = await handleGiftLifecycle(
      "pause",
      post("pause", {}, { origin: "https://attacker.example.test" }),
      context,
      dependencies,
    );
    expect(foreign.status).toBe(403);
    expect(limit).not.toHaveBeenCalled();

    const badPath = await handleGiftLifecycle(
      "pause",
      post("pause"),
      {
        params: Promise.resolve({ publicId: "../x" }),
      },
      dependencies,
    );
    expect(badPath.status).toBe(404);

    const body = await handleGiftLifecycle(
      "delete",
      post("delete", { force: true }),
      context,
      dependencies,
    );
    expect(body.status).toBe(400);

    limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const limited = await handleGiftLifecycle("delete", post("delete"), context, dependencies);
    expect(limited.status).toBe(429);

    expect(pause).not.toHaveBeenCalled();
    expect(deleteGift).not.toHaveBeenCalled();
  });

  it("answers 500 when the change fails", async () => {
    deleteGift.mockRejectedValueOnce(new Error("database down"));

    const response = await handleGiftLifecycle("delete", post("delete"), context, dependencies);

    expect(response.status).toBe(500);
  });
});
