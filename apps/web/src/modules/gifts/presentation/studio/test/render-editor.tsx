import {
  type AnalyticsContext,
  type LicensedAudioTrackDto,
  type MediaAssetDto,
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
}>;

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
              gift: draftGift(body.content, { revision: body.expectedRevision + 1 }),
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
  publishable?: boolean;
  publishEnabled?: boolean;
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
        revision: options.revision ?? 0,
      })}
      manifest={options.manifest ?? steppedManifest}
      publishable={options.publishable ?? true}
      publishEnabled={options.publishEnabled ?? false}
      signedIn={options.signedIn ?? false}
    />
  );
}

export function renderEditor(options: RenderEditorOptions = {}) {
  return render(editorElement(options));
}
