import {
  type AnalyticsContext,
  type GiftPublicationSummary,
  type LicensedAudioTrackDto,
  type MediaAssetDto,
  type PlanOfferDto,
} from "@love-memory/contracts";
import { type TemplateManifest } from "@love-memory/template-sdk";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { DraftEditor } from "../../draft-editor";
import { draftGift, jsonResponse, steppedManifest } from "./fixtures";

export const track: LicensedAudioTrackDto = {
  artist: "Nhóm Sóng",
  durationSec: 128,
  id: "acoustic-morning",
  title: "Buổi sáng mộc",
  url: "/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3",
};

export type PatchBody = Readonly<{
  content: Record<string, unknown>;
  expectedRevision: number;
}>;

type StudioFetchOptions = Readonly<{
  assets?: readonly MediaAssetDto[];
  get?: () => Response | Promise<Response>;
  patch?: (body: PatchBody, init: RequestInit) => Response | Promise<Response>;
  preview?: (init: RequestInit) => Response | Promise<Response>;
  publish?: (init: RequestInit) => Response | Promise<Response>;
  /** A published gift: the default save answers with its working copy and this publication. */
  publication?: GiftPublicationSummary;
}>;

/**
 * The offers the page renders: Free, and Standard unavailable (no checkout yet) or granted
 * internally. The values are those of `gift-plans`.
 */
export function studioPlanOffers(
  standard: "internal" | "unavailable" = "unavailable",
): PlanOfferDto[] {
  return [
    {
      available: true,
      internalGrant: false,
      maxPhotos: 3,
      name: "Miễn phí",
      planId: "free",
      planVersion: 1,
      priceVnd: 0,
      retentionDays: 14,
      watermark: true,
    },
    {
      available: standard === "internal",
      internalGrant: standard === "internal",
      maxPhotos: null,
      name: "Tiêu chuẩn",
      planId: "standard",
      planVersion: 1,
      priceVnd: 49_000,
      retentionDays: 365,
      watermark: false,
    },
  ];
}

/** `count` photos for the `memories` field, with their ready assets. */
export function studioPhotos(count: number) {
  const ids = Array.from(
    { length: count },
    (_, index) => `550e8400-e29b-41d4-a716-4466554400${String(index).padStart(2, "0")}`,
  );
  return {
    assets: ids.map((assetId) => readyAsset(assetId)),
    memories: ids.map((assetId) => ({ assetId })),
  };
}

export function readyAsset(assetId: string, fieldId = "memories"): MediaAssetDto {
  return {
    assetId,
    derivatives: [],
    failureCode: null,
    fieldId,
    placeholderDataUrl: null,
    status: "ready",
  };
}

export function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Stubs the media list, draft save and draft read endpoints the Studio calls. */
export function stubStudioFetch(options: StudioFetchOptions = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url === "/api/events" && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.startsWith("/api/media/assets?")) {
      return Promise.resolve(jsonResponse({ data: { assets: options.assets ?? [] } }));
    }
    if (url.endsWith("/preview") && init?.method === "POST" && options.preview) {
      return Promise.resolve(options.preview(init));
    }
    if (url.endsWith("/publish") && init?.method === "POST" && options.publish) {
      return Promise.resolve(options.publish(init));
    }
    if (url.startsWith("/api/gifts/") && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string) as PatchBody;
      return Promise.resolve(
        options.patch?.(body, init) ??
          jsonResponse({
            data: {
              gift: draftGift(body.content, {
                ...(options.publication
                  ? { ownerKind: "user", publication: options.publication, status: "published" }
                  : {}),
                revision: body.expectedRevision + 1,
              }),
            },
          }),
      );
    }
    if (url.startsWith("/api/gifts/") && init?.method === "GET" && options.get) {
      return Promise.resolve(options.get());
    }
    throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function patchBodies(fetchMock: ReturnType<typeof stubStudioFetch>): PatchBody[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(init?.body as string) as PatchBody);
}

export function setStudioUrl(search = "") {
  window.history.replaceState(null, "", `/studio/q1w2e3r4t5y6u7i8${search}`);
}

/** A valid page analytics context for the Studio tests. */
export const studioAnalytics: AnalyticsContext = {
  giftRef: "S".repeat(42) + "1",
  templateId: "memory-box",
  templateVersion: "1.1.0",
};

/** The funnel events the editor sent, by name, in order. */
export function analyticsEventNames(fetchMock: ReturnType<typeof stubStudioFetch>): string[] {
  return fetchMock.mock.calls
    .filter(([input]) => urlOf(input) === "/api/events")
    .map(([, init]) => (JSON.parse(init?.body as string) as { name: string }).name);
}

export type RenderEditorOptions = Readonly<{
  analytics?: AnalyticsContext | null;
  audioTracks?: readonly LicensedAudioTrackDto[];
  content?: Record<string, unknown>;
  manifest?: TemplateManifest;
  ownerKind?: "anonymous" | "user";
  /** The page's plan offers; Free and an unavailable Standard by default. */
  planOffers?: readonly PlanOfferDto[];
  publishable?: boolean;
  /** Renders a published gift whose working copy the editor edits. */
  publication?: GiftPublicationSummary;
  revision?: number;
  signedIn?: boolean;
}>;

export function editorElement(options: RenderEditorOptions = {}) {
  return (
    <DraftEditor
      analytics={options.analytics ?? null}
      audioTracks={options.audioTracks ?? [track]}
      gift={draftGift(options.content ?? {}, {
        ownerKind: options.ownerKind ?? "anonymous",
        ...(options.publication
          ? { publication: options.publication, status: "published" as const }
          : {}),
        revision: options.revision ?? 0,
      })}
      manifest={options.manifest ?? steppedManifest}
      planOffers={options.planOffers ?? studioPlanOffers()}
      publishable={options.publishable ?? true}
      signedIn={options.signedIn ?? false}
    />
  );
}

export function renderEditor(options: RenderEditorOptions = {}) {
  return render(editorElement(options));
}
