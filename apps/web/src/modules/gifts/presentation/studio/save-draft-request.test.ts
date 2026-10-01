import { afterEach, describe, expect, it, vi } from "vitest";

import { hangingFetch } from "@/http/test/hanging-fetch";

import { DRAFT_REQUEST_TIMEOUT_MILLISECONDS, loadDraft, saveDraft } from "./save-draft-request";
import { apiError, draftGift, jsonResponse } from "./test/fixtures";

function fetchReturning(response: Response | Error) {
  return vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
}

describe("saveDraft", () => {
  it("sends the content with the expected revision and classifies a saved draft", async () => {
    const gift = draftGift({ "receiver-name": "Linh" }, { revision: 4 });
    const fetch = fetchReturning(jsonResponse({ data: { gift } }));

    const outcome = await saveDraft("q1w2e3r4t5y6u7i8", { "receiver-name": "Linh " }, 3, {
      fetch,
    });

    expect(outcome).toEqual({ gift, kind: "saved" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/gifts/q1w2e3r4t5y6u7i8");
    expect(init).toMatchObject({ keepalive: false, method: "PATCH" });
    expect(JSON.parse(init?.body as string)).toEqual({
      content: { "receiver-name": "Linh " },
      expectedRevision: 3,
    });
  });

  it.each([
    [
      "a revision conflict",
      jsonResponse(
        apiError("CONFLICT", { details: { actualRevision: 5, expectedRevision: 4 } }),
        409,
      ),
      { actualRevision: 5, kind: "conflict" },
    ],
    ["a conflict without a revision", jsonResponse(apiError("CONFLICT"), 409), { kind: "gone" }],
    ["a missing draft", jsonResponse(apiError("NOT_FOUND"), 404), { kind: "gone" }],
    [
      "a validation error",
      jsonResponse(
        apiError("VALIDATION_ERROR", { fieldErrors: { "memories.1.caption": "Too long" } }),
        400,
      ),
      { fieldErrors: { "memories.1.caption": "Too long" }, kind: "invalid" },
    ],
    [
      "a validation error without a body",
      new Response("not json", { status: 400 }),
      { fieldErrors: {}, kind: "invalid" },
    ],
    [
      "a rate limit",
      jsonResponse(apiError("RATE_LIMITED", { details: { retryAfterSeconds: 20 } }), 429),
      { kind: "rate-limited", retryAfterSeconds: 20 },
    ],
    [
      "a rate limit without details",
      jsonResponse(apiError("RATE_LIMITED"), 429),
      { kind: "rate-limited", retryAfterSeconds: null },
    ],
    ["a server error", jsonResponse(apiError("SERVICE_UNAVAILABLE"), 503), { kind: "transient" }],
    [
      "a forbidden request",
      jsonResponse(apiError("FORBIDDEN"), 403),
      { kind: "rejected", status: 403 },
    ],
    ["an invalid success body", jsonResponse({ data: { gift: { id: 1 } } }), { kind: "transient" }],
  ])("classifies %s", async (_, response, expected) => {
    await expect(
      saveDraft("q1w2e3r4t5y6u7i8", {}, 0, { fetch: fetchReturning(response) }),
    ).resolves.toEqual(expected);
  });

  it("classifies a rejected fetch by the browser's online state", async () => {
    const fetch = fetchReturning(new TypeError("Failed to fetch"));

    await expect(
      saveDraft("q1w2e3r4t5y6u7i8", {}, 0, { fetch, isOnline: () => true }),
    ).resolves.toEqual({
      kind: "transient",
    });
    await expect(
      saveDraft("q1w2e3r4t5y6u7i8", {}, 0, { fetch, isOnline: () => false }),
    ).resolves.toEqual({ kind: "offline" });
  });

  it("reads navigator.onLine by default", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(
      saveDraft("q1w2e3r4t5y6u7i8", {}, 0, { fetch: fetchReturning(new TypeError("offline")) }),
    ).resolves.toEqual({ kind: "offline" });
    onLine.mockRestore();
  });

  it("uses keepalive only for bodies under 60 KiB", async () => {
    const fetch = fetchReturning(jsonResponse({ data: { gift: draftGift() } }));

    await saveDraft("q1w2e3r4t5y6u7i8", { "final-letter": "a" }, 0, { fetch, keepalive: true });
    await saveDraft("q1w2e3r4t5y6u7i8", { "final-letter": "a".repeat(61 * 1024) }, 0, {
      fetch,
      keepalive: true,
    });

    expect(fetch.mock.calls[0]?.[1]?.keepalive).toBe(true);
    expect(fetch.mock.calls[1]?.[1]?.keepalive).toBe(false);
  });

  it("uses the global fetch when none is injected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ data: { gift: draftGift() } }))),
    );

    await expect(saveDraft("q1w2e3r4t5y6u7i8", {}, 0)).resolves.toMatchObject({ kind: "saved" });
    await expect(loadDraft("q1w2e3r4t5y6u7i8")).resolves.toMatchObject({ kind: "loaded" });
    vi.unstubAllGlobals();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("draft request timeout", () => {
  it("aborts a stalled save and classifies it as a network failure (Stalled save)", async () => {
    vi.useFakeTimers();
    const fetch = hangingFetch();
    const online = saveDraft("q1w2e3r4t5y6u7i8", {}, 0, { fetch, isOnline: () => true });
    const offline = saveDraft("q1w2e3r4t5y6u7i8", {}, 0, { fetch, isOnline: () => false });

    await vi.advanceTimersByTimeAsync(DRAFT_REQUEST_TIMEOUT_MILLISECONDS);
    await expect(online).resolves.toEqual({ kind: "transient" });
    await expect(offline).resolves.toEqual({ kind: "offline" });
  });

  it("aborts a stalled reload and reports it as failed", async () => {
    vi.useFakeTimers();
    const outcome = loadDraft("q1w2e3r4t5y6u7i8", { fetch: hangingFetch() });

    await vi.advanceTimersByTimeAsync(DRAFT_REQUEST_TIMEOUT_MILLISECONDS);
    await expect(outcome).resolves.toEqual({ kind: "failed" });
  });
});

describe("loadDraft", () => {
  it("reads the stored draft without caching", async () => {
    const gift = draftGift({ "receiver-name": "Tab A" }, { revision: 6 });
    const fetch = fetchReturning(jsonResponse({ data: { gift } }));

    await expect(loadDraft("q1w2e3r4t5y6u7i8", { fetch })).resolves.toEqual({
      gift,
      kind: "loaded",
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", method: "GET" });
  });

  it.each([
    ["a missing draft", fetchReturning(jsonResponse(apiError("NOT_FOUND"), 404)), { kind: "gone" }],
    [
      "a server error",
      fetchReturning(jsonResponse(apiError("INTERNAL_ERROR"), 500)),
      { kind: "failed" },
    ],
    ["an invalid body", fetchReturning(jsonResponse({ data: null })), { kind: "failed" }],
    ["a network error", fetchReturning(new TypeError("offline")), { kind: "failed" }],
  ])("classifies %s", async (_, fetch, expected) => {
    await expect(loadDraft("q1w2e3r4t5y6u7i8", { fetch })).resolves.toEqual(expected);
  });
});
