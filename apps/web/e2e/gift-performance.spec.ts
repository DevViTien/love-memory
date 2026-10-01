import { type Browser, type Page, type Request } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { deleteAnalyticsEvents, giftRefOf } from "./support/analytics";
import { uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  type E2eRecord,
  publishTypicalMemoryBox,
  waitForHydration,
} from "./support/gift-journey";
import { expect, test } from "./test";

// The Gate M2 cold-cache baseline of the public gift page (`add-funnel-analytics` D12). It runs
// only through `pnpm test:e2e:perf` (`--grep @perf --project=mobile-chromium --workers=1`), so
// no other spec or worker disturbs the numbers. It records lab values; it asserts no timing.

const VIEWER_TITLE = "LoveMemory template viewer";
const RUNS_PER_PROFILE = 3;
const ARTIFACT_JS_GZIP_BUDGET_BYTES = 60 * 1024;
/** The typical gift of `publishTypicalMemoryBox` has three photos. */
const PHOTO_COUNT = 3;

type Profile = Readonly<{
  cpuThrottlingRate?: number;
  name: "slow-4g" | "unthrottled";
  network?: Readonly<{
    downloadBitsPerSecond: number;
    latencyMs: number;
    uploadBitsPerSecond: number;
  }>;
}>;

const PROFILES: readonly Profile[] = [
  { name: "unthrottled" },
  {
    cpuThrottlingRate: 4,
    name: "slow-4g",
    network: { downloadBitsPerSecond: 1_600_000, latencyMs: 150, uploadBitsPerSecond: 750_000 },
  },
];

type RecordedRequest = Readonly<{
  afterTap: boolean;
  encodedBodyBytes: number;
  request: Request;
  resourceType: string;
  /** Wall-clock milliseconds when the test saw the request finish (body received). */
  finishedAt: number;
  /** Wall-clock milliseconds when the test saw the request start. */
  requestedAt: number;
  url: string;
}>;

type RunMetrics = Readonly<{
  /** Encoded body bytes after the tap, by category. */
  afterTapBytes: Readonly<{ artifact: number; audio: number; images: number; payload: number }>;
  /** Encoded body bytes and request counts before the tap, by resource type. */
  beforeTap: Readonly<Record<string, Readonly<{ bytes: number; requests: number }>>>;
  domContentLoadedMs: number;
  firstImageResponseEndMs: number | null;
  lcpElement: string | null;
  lcpMs: number | null;
  openingVisibleMs: number;
  payloadResponseEndMs: number | null;
  profile: Profile["name"];
  run: number;
  ttfbMs: number;
}>;

let shareUrl = "";
let giftRef = "";
let record: E2eRecord | null = null;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function deviceOptions() {
  const { deviceScaleFactor, hasTouch, isMobile, userAgent, viewport } = test.info().project.use;
  return {
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
    ...(hasTouch === undefined ? {} : { hasTouch }),
    ...(isMobile === undefined ? {} : { isMobile }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(viewport === undefined ? {} : { viewport }),
  };
}

function category(entry: RecordedRequest): "artifact" | "audio" | "images" | "payload" | null {
  const { pathname } = new URL(entry.url);
  if (pathname.startsWith("/template-artifacts/")) return "artifact";
  if (pathname.startsWith("/api/public-gifts/")) return "payload";
  if (entry.resourceType === "image") return "images";
  if (entry.resourceType === "media" || pathname.startsWith("/audio-library/")) return "audio";
  return null;
}

async function throttle(page: Page, profile: Profile): Promise<void> {
  if (!profile.network && !profile.cpuThrottlingRate) return;
  const cdp = await page.context().newCDPSession(page);
  if (profile.network) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      downloadThroughput: profile.network.downloadBitsPerSecond / 8,
      latency: profile.network.latencyMs,
      offline: false,
      uploadThroughput: profile.network.uploadBitsPerSecond / 8,
    });
  }
  if (profile.cpuThrottlingRate) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottlingRate });
  }
}

/** One cold run: a new context (empty HTTP cache, service workers blocked) on the share link. */
async function measureRun(
  browser: Browser,
  profile: Profile,
  run: number,
): Promise<
  Readonly<{ artifactJsGzipBytes: number; metrics: RunMetrics; requests: RecordedRequest[] }>
> {
  const context = await browser.newContext({ ...deviceOptions(), serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await throttle(page, profile);
    await page.addInitScript(() => {
      const target = window as unknown as {
        __lcp: { element: string | null; startTime: number } | null;
      };
      target.__lcp = null;
      new PerformanceObserver((list) => {
        const entry = list.getEntries().at(-1) as
          (PerformanceEntry & { element?: Element | null }) | undefined;
        if (entry) {
          target.__lcp = { element: entry.element?.tagName ?? null, startTime: entry.startTime };
        }
      }).observe({ buffered: true, type: "largest-contentful-paint" });
    });

    // Wall-clock times: Chromium applies the emulated latency outside Navigation and Resource
    // Timing, so browser-relative values alone would hide it. Every time below is measured from
    // the moment the test starts the navigation (or clicks `Mở quà`).
    let tapAt = Number.POSITIVE_INFINITY;
    const requests: RecordedRequest[] = [];
    const requestedAt = new Map<Request, number>();
    const finished: Array<Promise<void>> = [];
    page.on("request", (request) => requestedAt.set(request, Date.now()));
    page.on("requestfinished", (request) => {
      const finishedAt = Date.now();
      finished.push(
        (async () => {
          const sizes = await request.sizes();
          const started = requestedAt.get(request) ?? finishedAt;
          requests.push({
            afterTap: started >= tapAt,
            encodedBodyBytes: sizes.responseBodySize,
            finishedAt,
            request,
            requestedAt: started,
            resourceType: request.resourceType(),
            url: request.url(),
          });
        })(),
      );
    });

    const navigationStart = Date.now();
    await page.goto(shareUrl, { waitUntil: "commit" });
    // The document response committed: Chromium's emulated latency does not show in Navigation
    // Timing's `responseStart`, so TTFB is this wall-clock commit time.
    const commitMs = Date.now() - navigationStart;
    await page.waitForLoadState("load");
    const open = page.getByRole("button", { name: "Mở quà" });
    await waitForHydration(open);
    const navigation = await page.evaluate((start) => {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const lcp = (
        window as unknown as { __lcp: { element: string | null; startTime: number } | null }
      ).__lcp;
      const wall = (value: number) => Math.round(performance.timeOrigin + value - start);
      return {
        domContentLoadedMs: wall(entry.domContentLoadedEventEnd),
        lcp: lcp ? { element: lcp.element, ms: wall(lcp.startTime) } : null,
      };
    }, navigationStart);
    await Promise.all(finished);
    const beforeTap = [...requests];

    tapAt = Date.now();
    await open.click();
    const frame = page.frameLocator(`iframe[title="${VIEWER_TITLE}"]`);
    await frame
      .locator('section[data-scene="opening"]')
      .waitFor({ state: "visible", timeout: 60_000 });
    const openingVisibleMs = Date.now() - tapAt;
    // Every photo of the gift (the template preloads them on INIT).
    await expect
      .poll(
        () => requests.filter((entry) => entry.afterTap && entry.resourceType === "image").length,
        { timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(PHOTO_COUNT);
    await Promise.all(finished);

    const afterTap = requests.filter((entry) => entry.afterTap);
    const firstImage = afterTap
      .filter((entry) => entry.resourceType === "image")
      .sort((left, right) => left.requestedAt - right.requestedAt)[0];
    const payload = afterTap.find((entry) => category(entry) === "payload");
    const bytesOf = (name: NonNullable<ReturnType<typeof category>>) =>
      afterTap
        .filter((entry) => category(entry) === name)
        .reduce((sum, entry) => sum + entry.encodedBodyBytes, 0);
    const byType: Record<string, { bytes: number; requests: number }> = {};
    for (const entry of beforeTap) {
      const bucket = (byType[entry.resourceType] ??= { bytes: 0, requests: 0 });
      bucket.bytes += entry.encodedBodyBytes;
      bucket.requests += 1;
    }

    // The artifact's JS, gzip-compressed here so the figure does not depend on server compression.
    let artifactJsGzipBytes = 0;
    for (const script of afterTap.filter(
      (entry) => category(entry) === "artifact" && /\.m?js$/.test(new URL(entry.url).pathname),
    )) {
      const body = await (await script.request.response())?.body();
      if (body) artifactJsGzipBytes += gzipSync(body).length;
    }

    return {
      artifactJsGzipBytes,
      metrics: {
        afterTapBytes: {
          artifact: bytesOf("artifact"),
          audio: bytesOf("audio"),
          images: bytesOf("images"),
          payload: bytesOf("payload"),
        },
        beforeTap: byType,
        domContentLoadedMs: navigation.domContentLoadedMs,
        firstImageResponseEndMs: firstImage ? firstImage.finishedAt - tapAt : null,
        lcpElement: navigation.lcp?.element ?? null,
        lcpMs: navigation.lcp?.ms ?? null,
        openingVisibleMs,
        payloadResponseEndMs: payload ? payload.finishedAt - tapAt : null,
        profile: profile.name,
        run,
        ttfbMs: commitMs,
      },
      requests,
    };
  } finally {
    await context.close();
  }
}

function markdownTable(runs: readonly RunMetrics[]): string {
  const rows = PROFILES.map((profile) => {
    const of = (pick: (metrics: RunMetrics) => number | null) =>
      median(
        runs
          .filter((metrics) => metrics.profile === profile.name)
          .map(pick)
          .filter((value): value is number => value !== null),
      );
    const kib = (bytes: number | null) => (bytes === null ? "—" : (bytes / 1024).toFixed(1));
    const beforeBytes = of((metrics) =>
      Object.values(metrics.beforeTap).reduce((sum, bucket) => sum + bucket.bytes, 0),
    );
    const beforeRequests = of((metrics) =>
      Object.values(metrics.beforeTap).reduce((sum, bucket) => sum + bucket.requests, 0),
    );
    return [
      profile.name,
      of((metrics) => metrics.ttfbMs),
      of((metrics) => metrics.domContentLoadedMs),
      of((metrics) => metrics.lcpMs),
      `${beforeRequests ?? "—"} / ${kib(beforeBytes)}`,
      of((metrics) => metrics.payloadResponseEndMs),
      of((metrics) => metrics.openingVisibleMs),
      of((metrics) => metrics.firstImageResponseEndMs),
      kib(of((metrics) => metrics.afterTapBytes.artifact)),
      kib(of((metrics) => metrics.afterTapBytes.payload)),
      kib(of((metrics) => metrics.afterTapBytes.images)),
      kib(of((metrics) => metrics.afterTapBytes.audio)),
    ].join(" | ");
  });
  return [
    "| Profile | TTFB (commit) ms | DCL ms | Envelope LCP ms | Before tap: requests / KiB | Payload end ms | Opening visible ms | First image end ms | Artifact KiB | Payload KiB | Images KiB | Audio KiB |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    `Medians of ${RUNS_PER_PROFILE} cold runs per profile; wall-clock milliseconds from the start of the navigation, or from the click for the times after the tap. Lab values (Playwright, Pixel 7 emulation; slow-4g = CDP 150 ms latency, 1.6 Mbit/s down, 750 kbit/s up, CPU ×4).`,
  ].join("\n");
}

test.describe("public gift performance baseline", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const context = await browser.newContext(deviceOptions());
    try {
      const page = await context.newPage();
      const published = await publishTypicalMemoryBox(
        page,
        resolve(dirname(testInfo.file), "fixtures"),
        uniqueE2eEmail("performance", testInfo),
      );
      record = published.record;
      shareUrl = published.shareUrl;
      giftRef = giftRefOf(published.giftId);
    } finally {
      await context.close();
    }
  });

  test.afterAll(async () => {
    if (record) await cleanupE2eRecord(record);
    await deleteAnalyticsEvents(giftRef ? [giftRef] : []);
  });

  test(
    "records the cold-cache baseline of the public gift page",
    { tag: "@perf" },
    async ({ browser }, testInfo) => {
      test.setTimeout(900_000);
      const appOrigin = new URL(shareUrl).origin;
      const runs: RunMetrics[] = [];
      let artifactJsGzipBytes: number | null = null;

      for (const profile of PROFILES) {
        for (let run = 1; run <= RUNS_PER_PROFILE; run += 1) {
          const measured = await measureRun(browser, profile, run);
          const { metrics, requests } = measured;
          runs.push(metrics);
          artifactJsGzipBytes ??= measured.artifactJsGzipBytes;

          // Budget sanity, not timing: nothing but the app origin, and no gift media before the tap.
          const foreign = requests
            .map((entry) => new URL(entry.url))
            .filter((url) => /^https?:$/.test(url.protocol) && url.origin !== appOrigin)
            .map((url) => url.href);
          expect(foreign, "requests to another origin").toEqual([]);
          const earlyMedia = requests
            .filter(
              (entry) =>
                !entry.afterTap &&
                (entry.resourceType === "image" ||
                  entry.resourceType === "media" ||
                  new URL(entry.url).pathname.startsWith("/api/public-gifts/")),
            )
            .map((entry) => entry.url);
          expect(earlyMedia, "image, audio or payload requests before the tap").toEqual([]);
        }
      }

      expect(artifactJsGzipBytes, "gzip-compressed artifact JS").toBeGreaterThan(0);
      expect(artifactJsGzipBytes!).toBeLessThanOrEqual(ARTIFACT_JS_GZIP_BUDGET_BYTES);

      const report = {
        artifactJsGzipBytes,
        browserVersion: browser.version(),
        measuredAt: new Date().toISOString(),
        medians: Object.fromEntries(
          PROFILES.map((profile) => {
            const ofProfile = runs.filter((metrics) => metrics.profile === profile.name);
            const pick = (selector: (metrics: RunMetrics) => number | null) =>
              median(ofProfile.map(selector).filter((value): value is number => value !== null));
            return [
              profile.name,
              {
                artifactBytes: pick((metrics) => metrics.afterTapBytes.artifact),
                audioBytes: pick((metrics) => metrics.afterTapBytes.audio),
                domContentLoadedMs: pick((metrics) => metrics.domContentLoadedMs),
                firstImageResponseEndMs: pick((metrics) => metrics.firstImageResponseEndMs),
                imageBytes: pick((metrics) => metrics.afterTapBytes.images),
                lcpMs: pick((metrics) => metrics.lcpMs),
                openingVisibleMs: pick((metrics) => metrics.openingVisibleMs),
                payloadBytes: pick((metrics) => metrics.afterTapBytes.payload),
                payloadResponseEndMs: pick((metrics) => metrics.payloadResponseEndMs),
                ttfbMs: pick((metrics) => metrics.ttfbMs),
              },
            ];
          }),
        ),
        profiles: PROFILES,
        runs,
      };
      const jsonPath = testInfo.outputPath("performance-baseline.json");
      const markdownPath = testInfo.outputPath("performance-baseline.md");
      await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(markdownPath, `${markdownTable(runs)}\n`);
      await testInfo.attach("performance-baseline.json", {
        contentType: "application/json",
        path: jsonPath,
      });
      await testInfo.attach("performance-baseline.md", {
        contentType: "text/markdown",
        path: markdownPath,
      });
    },
  );
});
