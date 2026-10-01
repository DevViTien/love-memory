import { describe, expect, it, vi } from "vitest";

import { type AnalyticsMemory, createAnalyticsClient } from "./analytics-client";

const giftRef = "A".repeat(42) + "1";
const otherGiftRef = "B".repeat(42) + "2";
const context = { giftRef, templateId: "memory-box", templateVersion: "1.1.0" } as const;
const uuids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

function freshMemory(): AnalyticsMemory {
  return { once: new Set(), sessions: new Map() };
}

function setup(
  overrides: Partial<Parameters<typeof createAnalyticsClient>[0]> = {},
  storage: MemoryStorage = new MemoryStorage(),
) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  let next = 0;
  const client = createAnalyticsClient({
    context,
    fetch: fetchMock,
    memory: freshMemory(),
    navigator: {},
    randomUUID: () => uuids[next++] ?? "44444444-4444-4444-8444-444444444444",
    storage: () => storage,
    ...overrides,
  });
  return { client, fetchMock, storage };
}

function sentBodies(fetchMock: ReturnType<typeof setup>["fetchMock"]) {
  return fetchMock.mock.calls.map(
    ([, init]) => JSON.parse(init?.body as string) as Record<string, string>,
  );
}

describe("analytics browser client", () => {
  it("sends one same-origin keepalive request without credentials, cache or a mode", () => {
    const { client, fetchMock } = setup();
    client.send("gift_open_interaction");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/events");
    expect(init).toEqual({
      body: expect.any(String) as string,
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
      referrerPolicy: "strict-origin",
    });
    expect(init).not.toHaveProperty("mode");
    expect(sentBodies(fetchMock)[0]).toEqual({
      giftRef,
      name: "gift_open_interaction",
      sessionId: uuids[0],
      templateId: "memory-box",
      templateVersion: "1.1.0",
    });
  });

  it("adds the scene id to scene_completed and skips a scene id that is not a slug", () => {
    const { client, fetchMock } = setup();
    client.send("scene_completed", "memory-1");
    client.send("scene_completed", "Memory 1");
    client.send("scene_completed");

    expect(sentBodies(fetchMock)).toEqual([
      expect.objectContaining({ name: "scene_completed", sceneId: "memory-1" }),
    ]);
  });

  it("swallows a rejected request and a synchronous throw, with no retry", async () => {
    const rejecting = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const { client } = setup({ fetch: rejecting });
    expect(() => client.send("gift_completed")).not.toThrow();
    await Promise.resolve();
    expect(rejecting).toHaveBeenCalledTimes(1);

    const throwing = vi.fn(() => {
      throw new TypeError("keepalive quota exceeded");
    });
    const second = setup({ fetch: throwing });
    expect(() => second.client.send("gift_completed")).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it("keeps one session id per gift in session storage and reuses it after a reload", () => {
    const storage = new MemoryStorage();
    const first = setup({}, storage);
    first.client.send("customization_started");
    first.client.send("preview_started");

    expect(storage.getItem(`lm:analytics:session:${giftRef}`)).toBe(uuids[0]);
    // A reload: a new client and a new page memory, the same tab storage.
    const reloaded = setup({}, storage);
    reloaded.client.send("publish_clicked");
    expect(sentBodies(first.fetchMock).map((body) => body["sessionId"])).toEqual([
      uuids[0],
      uuids[0],
    ]);
    expect(sentBodies(reloaded.fetchMock)[0]?.["sessionId"]).toBe(uuids[0]);
  });

  it("gives two gifts in one tab different session ids (Two gifts in one tab)", () => {
    const storage = new MemoryStorage();
    const memory = freshMemory();
    const randomUUID = () => crypto.randomUUID();
    const first = setup({ memory, randomUUID }, storage);
    const second = setup(
      { context: { ...context, giftRef: otherGiftRef }, memory, randomUUID },
      storage,
    );
    first.client.send("gift_open_interaction");
    second.client.send("gift_open_interaction");

    const [a] = sentBodies(first.fetchMock);
    const [b] = sentBodies(second.fetchMock);
    expect(a?.["sessionId"]).not.toBe(b?.["sessionId"]);
    // The keys hold only the gift reference.
    expect([...storage.items.keys()].sort()).toEqual([
      `lm:analytics:session:${giftRef}`,
      `lm:analytics:session:${otherGiftRef}`,
    ]);
  });

  it("replaces a malformed stored session id", () => {
    const storage = new MemoryStorage();
    storage.setItem(`lm:analytics:session:${giftRef}`, "not-a-uuid");
    const { client, fetchMock } = setup({}, storage);
    client.send("gift_completed");
    expect(sentBodies(fetchMock)[0]?.["sessionId"]).toBe(uuids[0]);
    expect(storage.getItem(`lm:analytics:session:${giftRef}`)).toBe(uuids[0]);
  });

  it("keeps one in-memory session id per gift when storage throws (Session storage blocked)", () => {
    const memory = freshMemory();
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const first = setup({ memory, storage: blocked });
    first.client.send("gift_open_interaction");
    first.client.sendOnce("customization_started");
    first.client.sendOnce("customization_started");
    const second = setup({ memory, storage: blocked });
    second.client.send("gift_completed");

    const ids = [...sentBodies(first.fetchMock), ...sentBodies(second.fetchMock)].map(
      (body) => body["sessionId"],
    );
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  it("works without any session storage", () => {
    const { client, fetchMock } = setup({ storage: () => null });
    client.send("gift_completed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates sendOnce per name and gift across client instances sharing storage", () => {
    const storage = new MemoryStorage();
    const first = setup({}, storage);
    first.client.sendOnce("customization_started");
    first.client.sendOnce("customization_started");
    first.client.sendOnce("required_content_completed");
    const reloaded = setup({}, storage);
    reloaded.client.sendOnce("customization_started");
    const otherGift = setup({ context: { ...context, giftRef: otherGiftRef } }, storage);
    otherGift.client.sendOnce("customization_started");

    expect(sentBodies(first.fetchMock).map((body) => body["name"])).toEqual([
      "customization_started",
      "required_content_completed",
    ]);
    expect(reloaded.fetchMock).not.toHaveBeenCalled();
    expect(otherGift.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no context", { context: null }],
    ["an invalid context", { context: { ...context, giftRef: "short" } }],
    ["Global Privacy Control", { navigator: { globalPrivacyControl: true } }],
    ["Do Not Track", { navigator: { doNotTrack: "1" } }],
  ])("sends nothing with %s (Privacy signal)", (_case, overrides) => {
    const { client, fetchMock, storage } = setup(overrides);
    client.send("gift_open_interaction");
    client.sendOnce("customization_started");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.items.size).toBe(0);
  });

  it("uses the browser's fetch, storage and signals by default", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      window.sessionStorage.clear();
      createAnalyticsClient({ context }).send("gift_open_interaction");
      expect(fetchSpy).toHaveBeenCalledWith("/api/events", expect.anything());
      expect(window.sessionStorage.getItem(`lm:analytics:session:${giftRef}`)).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    } finally {
      fetchSpy.mockRestore();
      window.sessionStorage.clear();
    }
  });
});
