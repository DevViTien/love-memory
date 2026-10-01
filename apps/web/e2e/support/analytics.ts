import { expect, type Page, type Request } from "@playwright/test";
import { createHmac } from "node:crypto";
import { MongoClient } from "mongodb";

// The same fallback as `playwright.config.ts`, which passes this secret to the web server.
const giftRefSecret =
  process.env["ANALYTICS_GIFT_REF_SECRET"] || "playwright-analytics-gift-ref-secret-0001";

/** One `POST /api/events` a page sent: its parsed body, `Origin`, `Referer` and answer. */
export type RecordedEvent = Readonly<{
  body: Readonly<Record<string, string>>;
  origin: string | undefined;
  referer: string | undefined;
  status: number | null;
}>;

export type StoredAnalyticsEvent = Readonly<Record<string, unknown>> &
  Readonly<{
    expiresAt: Date;
    giftRef: string;
    name: string;
    occurredAt: Date;
    sceneId: string | null;
    sessionId: string | null;
  }>;

/** The `giftRef` the server computes for an internal gift id (`funnel-analytics`). */
export function giftRefOf(giftId: string): string {
  return createHmac("sha256", giftRefSecret).update(`lm-gift-ref:v1:${giftId}`).digest("base64url");
}

/**
 * Records every `POST /api/events` of a page, including requests sent with `keepalive` right
 * before a navigation. `settled()` waits until every recorded request has an answer.
 */
export function recordAnalyticsEvents(page: Page) {
  type Entry = { -readonly [Key in keyof RecordedEvent]: RecordedEvent[Key] } & {
    done: boolean;
  };
  const entries: Entry[] = [];
  const byRequest = new Map<Request, Entry>();
  const isEvent = (request: Request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/events";

  page.on("request", (request) => {
    if (!isEvent(request)) return;
    const entry: Entry = {
      body: JSON.parse(request.postData() ?? "{}") as Record<string, string>,
      done: false,
      origin: undefined,
      referer: undefined,
      status: null,
    };
    entries.push(entry);
    byRequest.set(request, entry);
    void request.allHeaders().then(
      (headers) => {
        entry.origin = headers["origin"];
        entry.referer = headers["referer"];
      },
      () => undefined,
    );
  });
  page.on("response", (response) => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on("requestfinished", (request) => {
    const entry = byRequest.get(request);
    if (!entry) return;
    void request.response().then(
      (response) => {
        entry.status = response?.status() ?? entry.status;
        entry.done = true;
      },
      () => {
        entry.done = true;
      },
    );
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.done = true;
  });

  return {
    events: entries as readonly RecordedEvent[],
    names: () => entries.map((entry) => entry.body["name"] ?? ""),
    /**
     * Waits (up to 10 s) until every recorded request finished or failed. A `keepalive` request
     * sent right before a navigation can lose its response in the browser's view; it stays `null`.
     */
    settled: async () => {
      await expect
        .poll(() => entries.every((entry) => entry.done), { timeout: 10_000 })
        .toBe(true)
        .catch(() => undefined);
    },
  };
}

async function withDatabase<T>(
  operation: (database: ReturnType<MongoClient["db"]>) => Promise<T>,
): Promise<T> {
  const uri = process.env["MONGODB_URI"];
  const databaseName = process.env["MONGODB_DATABASE"];
  if (!uri || !databaseName) {
    throw new Error("E2E database access requires MONGODB_URI and MONGODB_DATABASE.");
  }
  const client = await new MongoClient(uri).connect();
  try {
    return await operation(client.db(databaseName));
  } finally {
    await client.close();
  }
}

/**
 * The stored events of one gift, polled for up to 10 s until `ready` accepts them (writes are
 * best effort, and `gift_published` is written after the publish response).
 */
export async function readAnalyticsEvents(
  giftRef: string,
  ready: (events: readonly StoredAnalyticsEvent[]) => boolean = () => true,
): Promise<StoredAnalyticsEvent[]> {
  let events: StoredAnalyticsEvent[] = [];
  await expect
    .poll(
      async () => {
        events = await withDatabase((database) =>
          database
            .collection<StoredAnalyticsEvent>("analyticsEvents")
            .find({ giftRef })
            .sort({ occurredAt: 1 })
            .toArray(),
        );
        return ready(events);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return events;
}

/** Removes the events of these gifts; used in `afterAll`/`afterEach` of the specs that make them. */
export async function deleteAnalyticsEvents(giftRefs: readonly string[]): Promise<void> {
  if (giftRefs.length === 0) return;
  await withDatabase((database) =>
    database.collection("analyticsEvents").deleteMany({ giftRef: { $in: [...giftRefs] } }),
  );
}

/** How many times each name occurs. */
export function countByName(names: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}
