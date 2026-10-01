import { afterEach, describe, expect, it, vi } from "vitest";

import { hangingFetch } from "@/http/test/hanging-fetch";

import { type FlushResult } from "./autosave-controller";
import { PREVIEW_REQUEST_TIMEOUT_MILLISECONDS, requestPreview } from "./preview-action";

const publicId = "q1w2e3r4t5y6u7i8";
const url = `/preview/${"A-_b".repeat(10)}xyz`;
const saved: FlushResult = { kind: "saved", revision: 4 };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function stubFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
}

describe("requestPreview", () => {
  it.each<FlushResult>([
    { kind: "offline" },
    { kind: "invalid" },
    { actualRevision: 7, kind: "conflict" },
    { kind: "failed" },
  ])("sends nothing when saves settle as $kind", async (flushed) => {
    const fetchMock = stubFetch(json(201, {}));

    await expect(
      requestPreview({ fetch: fetchMock, flush: () => Promise.resolve(flushed), publicId }),
    ).resolves.toEqual({ kind: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests a link with an empty JSON body once the draft is saved", async () => {
    const fetchMock = stubFetch(
      json(201, { data: { expiresAt: "2026-10-01T10:30:00.000Z", url } }),
    );
    const flush = vi.fn(() => Promise.resolve(saved));

    await expect(requestPreview({ fetch: fetchMock, flush, publicId })).resolves.toEqual({
      kind: "open",
      url,
    });
    expect(flush).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/gifts/${publicId}/preview`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it("aborts a preview request that has not answered after 15 seconds (Preview request never answers)", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const outcome = requestPreview({
      fetch: fetchMock,
      flush: () => Promise.resolve(saved),
      publicId,
    });

    await vi.advanceTimersByTimeAsync(PREVIEW_REQUEST_TIMEOUT_MILLISECONDS);
    await expect(outcome).resolves.toEqual({ kind: "failed" });
  });

  it("treats an invalid 201 body as a failure", async () => {
    const fetchMock = stubFetch(
      json(201, { data: { expiresAt: "2026-10-01T10:30:00.000Z", url: "https://evil.example/" } }),
    );

    await expect(
      requestPreview({ fetch: fetchMock, flush: () => Promise.resolve(saved), publicId }),
    ).resolves.toEqual({ kind: "failed" });
  });

  it("classifies a rate limit with its retry delay", async () => {
    const fetchMock = stubFetch(
      json(429, {
        error: {
          code: "RATE_LIMITED",
          details: { retryAfterSeconds: 120 },
          message: "Too many requests. Please try again later.",
          requestId: "request-1",
        },
      }),
    );

    await expect(
      requestPreview({ fetch: fetchMock, flush: () => Promise.resolve(saved), publicId }),
    ).resolves.toEqual({ kind: "rate-limited", retryAfterSeconds: 120 });
  });

  it("classifies a rate limit without details", async () => {
    await expect(
      requestPreview({
        fetch: stubFetch(new Response("busy", { status: 429 })),
        flush: () => Promise.resolve(saved),
        publicId,
      }),
    ).resolves.toEqual({ kind: "rate-limited", retryAfterSeconds: null });
  });

  it("classifies 404 as gone", async () => {
    await expect(
      requestPreview({
        fetch: stubFetch(json(404, { error: { code: "NOT_FOUND" } })),
        flush: () => Promise.resolve(saved),
        publicId,
      }),
    ).resolves.toEqual({ kind: "gone" });
  });

  it.each([
    ["a 500", json(500, { error: { code: "INTERNAL_ERROR" } })],
    ["a rejected fetch", new TypeError("Failed to fetch")],
  ])("classifies %s as failed", async (_name, response) => {
    await expect(
      requestPreview({
        fetch: stubFetch(response),
        flush: () => Promise.resolve(saved),
        publicId,
      }),
    ).resolves.toEqual({ kind: "failed" });
  });
});

describe("requestPreview funnel report", () => {
  it("reports preview_started once, just before returning open", async () => {
    const order: string[] = [];
    const report = vi.fn(() => void order.push("report"));
    const fetchMock = vi.fn<typeof fetch>(() => {
      order.push("fetch");
      return Promise.resolve(json(201, { data: { expiresAt: "2026-10-01T10:30:00.000Z", url } }));
    });

    await expect(
      requestPreview({ fetch: fetchMock, flush: () => Promise.resolve(saved), publicId, report }),
    ).resolves.toEqual({ kind: "open", url });
    expect(report).toHaveBeenCalledExactlyOnceWith("preview_started");
    expect(order).toEqual(["fetch", "report"]);
  });

  it.each<[string, typeof fetch, FlushResult]>([
    ["blocked", stubFetch(json(201, {})), { kind: "offline" }],
    ["rate-limited", stubFetch(new Response("busy", { status: 429 })), saved],
    ["gone", stubFetch(json(404, { error: { code: "NOT_FOUND" } })), saved],
    ["failed", stubFetch(new TypeError("Failed to fetch")), saved],
    [
      "failed (invalid body)",
      stubFetch(json(201, { data: { url: "https://evil.example/" } })),
      saved,
    ],
  ])("reports nothing when the outcome is %s", async (_name, fetchMock, flushed) => {
    const report = vi.fn();
    const outcome = await requestPreview({
      fetch: fetchMock,
      flush: () => Promise.resolve(flushed),
      publicId,
      report,
    });
    expect(outcome.kind).not.toBe("open");
    expect(report).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
