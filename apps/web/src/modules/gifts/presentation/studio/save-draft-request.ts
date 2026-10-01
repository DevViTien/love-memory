import {
  ApiErrorResponseSchema,
  GiftDraftResponseSchema,
  type ApiError,
  type GiftDraftDto,
} from "@love-memory/contracts";

import { fetchWithTimeout } from "@/http/fetch-with-timeout";

import { type DraftContent } from "./draft-validation";

/** Browsers cap `keepalive` request bodies at 64 KiB; stay safely below it. */
export const KEEPALIVE_MAX_BODY_BYTES = 60 * 1024;

/** A save or reload that has not answered after 15 s is aborted and handled as a network error. */
export const DRAFT_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export type SaveOutcome =
  | Readonly<{ gift: GiftDraftDto; kind: "saved" }>
  | Readonly<{ actualRevision: number; kind: "conflict" }>
  | Readonly<{ fieldErrors: Readonly<Record<string, string>>; kind: "invalid" }>
  | Readonly<{ kind: "rate-limited"; retryAfterSeconds: number | null }>
  | Readonly<{ kind: "offline" }>
  | Readonly<{ kind: "transient" }>
  | Readonly<{ kind: "gone" }>
  | Readonly<{ kind: "rejected"; status: number }>;

export type LoadOutcome =
  | Readonly<{ gift: GiftDraftDto; kind: "loaded" }>
  | Readonly<{ kind: "gone" }>
  | Readonly<{ kind: "failed" }>;

export type DraftRequestOptions = Readonly<{
  fetch?: typeof fetch;
  isOnline?: () => boolean;
  keepalive?: boolean;
}>;

function draftUrl(publicId: string): string {
  return `/api/gifts/${encodeURIComponent(publicId)}`;
}

function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function parseDraft(payload: unknown): GiftDraftDto | null {
  const parsed = GiftDraftResponseSchema.safeParse(
    typeof payload === "object" && payload !== null && "data" in payload ? payload.data : null,
  );
  return parsed.success ? parsed.data.gift : null;
}

function parseApiError(payload: unknown): ApiError | null {
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.error : null;
}

async function classify(response: Response): Promise<SaveOutcome> {
  const payload = await readJson(response);
  if (response.status === 200) {
    const gift = parseDraft(payload);
    return gift ? { gift, kind: "saved" } : { kind: "transient" };
  }

  const error = parseApiError(payload);
  switch (response.status) {
    case 400:
      return { fieldErrors: error?.fieldErrors ?? {}, kind: "invalid" };
    case 404:
      return { kind: "gone" };
    case 409: {
      const actualRevision = error?.details?.["actualRevision"];
      return typeof actualRevision === "number"
        ? { actualRevision, kind: "conflict" }
        : { kind: "gone" };
    }
    case 429: {
      const retryAfterSeconds = error?.details?.["retryAfterSeconds"];
      return {
        kind: "rate-limited",
        retryAfterSeconds: typeof retryAfterSeconds === "number" ? retryAfterSeconds : null,
      };
    }
    default:
      return response.status >= 500
        ? { kind: "transient" }
        : { kind: "rejected", status: response.status };
  }
}

/**
 * Sends the complete content with `expectedRevision` and classifies the response. It never
 * rejects and never logs: the content is gift text.
 */
export async function saveDraft(
  publicId: string,
  content: DraftContent,
  expectedRevision: number,
  options: DraftRequestOptions = {},
): Promise<SaveOutcome> {
  const body = JSON.stringify({ content, expectedRevision });
  const keepalive =
    options.keepalive === true &&
    new TextEncoder().encode(body).byteLength < KEEPALIVE_MAX_BODY_BYTES;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      options.fetch ?? fetch,
      draftUrl(publicId),
      { body, headers: { "Content-Type": "application/json" }, keepalive, method: "PATCH" },
      DRAFT_REQUEST_TIMEOUT_MILLISECONDS,
    );
  } catch {
    return (options.isOnline ?? browserIsOnline)() ? { kind: "transient" } : { kind: "offline" };
  }
  return classify(response);
}

/** Reads the stored draft for `Tải bản mới nhất`. It never rejects. */
export async function loadDraft(
  publicId: string,
  options: DraftRequestOptions = {},
): Promise<LoadOutcome> {
  try {
    const response = await fetchWithTimeout(
      options.fetch ?? fetch,
      draftUrl(publicId),
      { cache: "no-store", method: "GET" },
      DRAFT_REQUEST_TIMEOUT_MILLISECONDS,
    );
    if (response.status === 404) return { kind: "gone" };
    const gift = response.ok ? parseDraft(await readJson(response)) : null;
    return gift ? { gift, kind: "loaded" } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
