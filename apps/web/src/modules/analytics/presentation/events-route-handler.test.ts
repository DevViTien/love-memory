import { type AnalyticsEventRequest } from "@love-memory/contracts";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import {
  type AnalyticsRateLimitScope,
  type EventsRouteDependencies,
  handlePostAnalyticsEvent,
} from "./events-route-handler";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const sessionId = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";
const validEvent = {
  giftRef: "R".repeat(43),
  name: "gift_open_interaction",
  sessionId,
  templateId: "memory-box",
  templateVersion: "1.1.0",
} as const;

type EventRequestInit = Readonly<{
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  userAgent?: string | null;
}>;

function eventRequest(init: EventRequestInit = {}): Request {
  const userAgent = init.userAgent === undefined ? CHROME_ANDROID : init.userAgent;
  return new Request("https://love.example/api/events", {
    body: init.body ?? JSON.stringify(validEvent),
    headers: {
      "content-type": init.contentType ?? "application/json",
      origin: "https://love.example",
      "sec-fetch-site": "same-origin",
      "x-request-id": "request-1",
      "x-vercel-forwarded-for": "203.0.113.10",
      ...(userAgent === null ? {} : { "user-agent": userAgent }),
      ...init.headers,
    },
    method: "POST",
    // A stream body (no `Content-Length`) needs half duplex.
    duplex: "half",
  } as RequestInit);
}

async function errorBody(response: Response) {
  return (
    (await response.json()) as {
      error: {
        code: string;
        details?: Record<string, unknown>;
        fieldErrors?: Record<string, string>;
        message: string;
      };
    }
  ).error;
}

describe("events route handler", () => {
  let consume: ReturnType<
    typeof vi.fn<
      (
        scope: AnalyticsRateLimitScope,
        subject: string,
      ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>
    >
  >;
  let recordBrowserEvent: ReturnType<
    typeof vi.fn<(event: AnalyticsEventRequest, now: Date) => Promise<void>>
  >;
  let enabled: boolean;
  let errorLog: MockInstance<typeof console.error>;
  const now = new Date("2026-10-01T08:00:00.000Z");

  beforeEach(() => {
    enabled = true;
    consume = vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 600 }));
    recordBrowserEvent = vi.fn(() => Promise.resolve());
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  function dependencies(): EventsRouteDependencies {
    return {
      consumeRateLimit: consume,
      getService: () => ({ recordBrowserEvent }),
      isEnabled: () => enabled,
      networkSubject: () => "ip:203.0.113.10",
      now: () => now,
      sessionSubject: (network, id) => `${network}|session:${id}`,
    };
  }

  function post(init?: EventRequestInit) {
    return handlePostAnalyticsEvent(eventRequest(init), dependencies());
  }

  it("stores a valid event and answers 204 with no body, no-store and the request id", async () => {
    const response = await post();

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(recordBrowserEvent).toHaveBeenCalledWith(validEvent, now);
    expect(consume.mock.calls).toEqual([
      ["analytics-event", `ip:203.0.113.10|session:${sessionId}`],
      ["analytics-event-ip", "ip:203.0.113.10"],
    ]);
  });

  it("stores a scene event with its scene id", async () => {
    const event = { ...validEvent, name: "scene_completed", sceneId: "memory-1" };
    const response = await post({ body: JSON.stringify(event) });
    expect(response.status).toBe(204);
    expect(recordBrowserEvent).toHaveBeenCalledWith(event, now);
  });

  it.each([
    ["an unknown name", { ...validEvent, name: "gift_viewed" }, "name"],
    ["a browser publish", { ...validEvent, name: "gift_published" }, "name"],
    ["an extra receiverName", { ...validEvent, receiverName: "Minh Thư" }, "body"],
    ["an extra shareId", { ...validEvent, shareId: "AbCdEfGhIjKlMnOpQrStUv" }, "body"],
    ["a scene event without sceneId", { ...validEvent, name: "scene_completed" }, "sceneId"],
    [
      "a gift_completed with sceneId",
      { ...validEvent, name: "gift_completed", sceneId: "letter" },
      "sceneId",
    ],
    [
      "a free-text sceneId",
      { ...validEvent, name: "scene_completed", sceneId: "Memory 1" },
      "sceneId",
    ],
  ])("rejects %s with 400 and charges nothing", async (_case, body, fieldPath) => {
    const response = await post({ body: JSON.stringify(body) });

    expect(response.status).toBe(400);
    const error = await errorBody(response);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(error.fieldErrors ?? {})).toContain(fieldPath);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(consume).not.toHaveBeenCalled();
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await post({ body: "{" });
    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        message: "Request body must be valid JSON.",
      }),
    );
    expect(consume).not.toHaveBeenCalled();
  });

  it("answers 400 for 100 invalid bodies without charging either counter", async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await post({ body: JSON.stringify({ ...validEvent, name: "nope" }) });
      expect(response.status).toBe(400);
    }
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects a declared 4096-byte body and a streamed 2049-byte body with 413", async () => {
    const declared = await post({ headers: { "content-length": "4096" } });
    const streamedText = JSON.stringify({ ...validEvent, padding: "x".repeat(2049) });
    const streamed = await post({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(streamedText));
          controller.close();
        },
      }),
    });

    for (const response of [declared, streamed]) {
      expect(response.status).toBe(413);
      expect(await errorBody(response)).toEqual(
        expect.objectContaining({
          code: "VALIDATION_ERROR",
          message: "Request body is too large.",
        }),
      );
    }
    expect(consume).not.toHaveBeenCalled();
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it("rejects a plain-text beacon with 415", async () => {
    const response = await post({ contentType: "text/plain;charset=UTF-8" });
    expect(response.status).toBe(415);
    expect((await errorBody(response)).code).toBe("VALIDATION_ERROR");
    expect(consume).not.toHaveBeenCalled();
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it.each([
    { origin: "https://attacker.example.test" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects the cross-origin request %o with 403", async (headers) => {
    const response = await post({ headers });
    expect(response.status).toBe(403);
    expect((await errorBody(response)).code).toBe("FORBIDDEN");
    expect(consume).not.toHaveBeenCalled();
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["the session counter", [false]],
    ["the network counter", [true, false]],
  ])("answers 429 with Retry-After when %s is exhausted", async (_case, allowed) => {
    allowed.forEach((value) =>
      consume.mockResolvedValueOnce({ allowed: value, retryAfterSeconds: 321 }),
    );
    const response = await post();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    const error = await errorBody(response);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.details).toEqual({ retryAfterSeconds: 321 });
    expect(consume).toHaveBeenCalledTimes(allowed.length);
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["a link preview crawler", { userAgent: "facebookexternalhit/1.1" }],
    ["a missing user agent", { userAgent: null }],
  ])("answers 204 for %s without storing or charging", async (_case, init) => {
    const response = await post(init);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(consume).not.toHaveBeenCalled();
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it("answers 204 while disabled, after the origin check, without storing or charging", async () => {
    enabled = false;
    const response = await post({ body: "not even json" });
    expect(response.status).toBe(204);
    expect(consume).not.toHaveBeenCalled();
    expect(recordBrowserEvent).not.toHaveBeenCalled();

    const crossSite = await post({ headers: { origin: "https://attacker.example.test" } });
    expect(crossSite.status).toBe(403);
  });

  it("answers 500 and logs only the operation and request id when storing fails", async () => {
    recordBrowserEvent.mockRejectedValue(new Error(`insert failed for ${validEvent.giftRef}`));
    const response = await post();

    expect(response.status).toBe(500);
    expect((await errorBody(response)).code).toBe("INTERNAL_ERROR");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(errorLog).toHaveBeenCalledWith("Operational request failed", {
      errorName: "Error",
      operation: "analytics_event_store",
      requestId: "request-1",
    });
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain(validEvent.giftRef);
    expect(logged).not.toContain(sessionId);
  });

  it("answers 500 and logs a rate-limit store failure under its own operation name", async () => {
    consume.mockRejectedValue(new Error("counter store down"));
    const response = await post();

    expect(response.status).toBe(500);
    expect((await errorBody(response)).code).toBe("INTERNAL_ERROR");
    expect(errorLog).toHaveBeenCalledWith("Operational request failed", {
      errorName: "Error",
      operation: "analytics_event_rate_limit",
      requestId: "request-1",
    });
    expect(recordBrowserEvent).not.toHaveBeenCalled();
  });

  it("uses a generated request id when none is supplied and the server clock by default", async () => {
    const { now: _now, ...withoutClock } = dependencies();
    const response = await handlePostAnalyticsEvent(
      eventRequest({ headers: { "x-request-id": "" } }),
      withoutClock,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(recordBrowserEvent.mock.lastCall?.[1]).toBeInstanceOf(Date);
  });
});
