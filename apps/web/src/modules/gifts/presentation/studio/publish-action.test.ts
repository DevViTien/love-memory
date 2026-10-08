import { afterEach, describe, expect, it, vi } from "vitest";

import { hangingFetch } from "@/http/test/hanging-fetch";

import { type FlushResult } from "./autosave-controller";
import { PUBLISH_REQUEST_TIMEOUT_MILLISECONDS, requestPublish } from "./publish-action";

const publicId = "q1w2e3r4t5y6u7i8";
const idempotencyKey = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";
const shareId = "Ab0_-cdefghijklmnopqrs";
const saved: FlushResult = { kind: "saved", revision: 4 };
const publication = {
  publicId,
  publishedAt: "2026-10-01T08:00:00.000Z",
  revision: 4,
  shareId,
  sharePath: `/g/${shareId}`,
  status: "published",
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function apiError(code: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message: "Request failed.", requestId: "request-1", ...extra } };
}

function stubFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
}

function publish(fetchMock: typeof fetch, flushed: FlushResult = saved) {
  return requestPublish({
    fetch: fetchMock,
    flush: () => Promise.resolve(flushed),
    idempotencyKey,
    publicId,
  });
}

describe("requestPublish", () => {
  it.each<FlushResult>([
    { kind: "offline" },
    { kind: "invalid" },
    { actualRevision: 7, kind: "conflict" },
    { kind: "failed" },
  ])("sends nothing when saves settle as $kind", async (flushed) => {
    const fetchMock = stubFetch(json(201, {}));

    await expect(publish(fetchMock, flushed)).resolves.toEqual({ kind: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes the flushed revision with the given key", async () => {
    const fetchMock = stubFetch(json(201, { data: { publication } }));

    await expect(publish(fetchMock)).resolves.toEqual({ kind: "published", publication });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/gifts/${publicId}/publish`, {
      body: JSON.stringify({ expectedRevision: 4 }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      method: "POST",
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it("treats an invalid 201 body as a failure", async () => {
    const fetchMock = stubFetch(
      json(201, { data: { publication: { ...publication, sharePath: "https://evil.example/" } } }),
    );

    await expect(publish(fetchMock)).resolves.toEqual({ kind: "failed" });
  });

  it("returns the field errors of a 400", async () => {
    const fieldErrors = { "memories.2": "This image is not ready." };
    const fetchMock = stubFetch(json(400, apiError("VALIDATION_ERROR", { fieldErrors })));

    await expect(publish(fetchMock)).resolves.toEqual({ fieldErrors, kind: "invalid" });
  });

  it("treats a 400 without field errors as a failure", async () => {
    await expect(publish(stubFetch(json(400, apiError("VALIDATION_ERROR"))))).resolves.toEqual({
      kind: "failed",
    });
  });

  it.each([
    [401, "UNAUTHORIZED", "unauthenticated"],
    [403, "FORBIDDEN", "forbidden"],
    [404, "NOT_FOUND", "gone"],
  ] as const)("maps %s to %s", async (status, code, kind) => {
    await expect(publish(stubFetch(json(status, apiError(code))))).resolves.toEqual({ kind });
  });

  it("maps a 409 with the actual revision to a conflict", async () => {
    const fetchMock = stubFetch(
      json(409, apiError("CONFLICT", { details: { actualRevision: 6, expectedRevision: 4 } })),
    );

    await expect(publish(fetchMock)).resolves.toEqual({ actualRevision: 6, kind: "conflict" });
  });

  it.each(["TEMPLATE_VERSION_UNPUBLISHABLE", "TEMPLATE_VERSION_NOT_EDITABLE"])(
    "maps a 409 with reason %s to unpublishable",
    async (reason) => {
      const fetchMock = stubFetch(json(409, apiError("CONFLICT", { details: { reason } })));

      await expect(publish(fetchMock)).resolves.toEqual({ kind: "unpublishable" });
    },
  );

  it("maps a 409 with ACCESS_POLICY_UNSUPPORTED to access-unsupported", async () => {
    const fetchMock = stubFetch(
      json(409, apiError("CONFLICT", { details: { reason: "ACCESS_POLICY_UNSUPPORTED" } })),
    );

    await expect(publish(fetchMock)).resolves.toEqual({ kind: "access-unsupported" });
  });

  it("maps a 409 without details to a reload", async () => {
    await expect(publish(stubFetch(json(409, apiError("CONFLICT"))))).resolves.toEqual({
      kind: "reload",
    });
  });

  it("maps a 409 with NO_UNPUBLISHED_CHANGES to a reload: published or updated elsewhere", async () => {
    const fetchMock = stubFetch(
      json(409, apiError("CONFLICT", { details: { reason: "NO_UNPUBLISHED_CHANGES" } })),
    );

    await expect(publish(fetchMock)).resolves.toEqual({ kind: "reload" });
  });

  it("treats a 409 with unknown details or an unreadable body as a failure", async () => {
    await expect(
      publish(stubFetch(json(409, apiError("CONFLICT", { details: { reason: "OTHER" } })))),
    ).resolves.toEqual({ kind: "failed" });
    await expect(publish(stubFetch(new Response("oops", { status: 409 })))).resolves.toEqual({
      kind: "failed",
    });
  });

  it("returns the retry delay of a 429", async () => {
    const limited = stubFetch(
      json(429, apiError("RATE_LIMITED", { details: { retryAfterSeconds: 120 } })),
    );
    const bare = stubFetch(new Response("", { status: 429 }));

    await expect(publish(limited)).resolves.toEqual({
      kind: "rate-limited",
      retryAfterSeconds: 120,
    });
    await expect(publish(bare)).resolves.toEqual({ kind: "rate-limited", retryAfterSeconds: null });
  });

  it("maps a 500 and a rejected fetch to a failure", async () => {
    await expect(publish(stubFetch(json(500, apiError("INTERNAL_ERROR"))))).resolves.toEqual({
      kind: "failed",
    });
    await expect(publish(stubFetch(new TypeError("offline")))).resolves.toEqual({
      kind: "failed",
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestPublish timeout", () => {
  it("aborts a publish request that has not answered after 30 seconds (Publish request never answers)", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const outcome = requestPublish({
      fetch: fetchMock,
      flush: () => Promise.resolve(saved),
      idempotencyKey,
      publicId,
    });

    await vi.advanceTimersByTimeAsync(PUBLISH_REQUEST_TIMEOUT_MILLISECONDS - 1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual({ kind: "failed" });
  });
});
