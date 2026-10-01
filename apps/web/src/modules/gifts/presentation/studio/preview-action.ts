import { ApiErrorResponseSchema, GiftPreviewLinkResponseSchema } from "@love-memory/contracts";

import { fetchWithTimeout } from "@/http/fetch-with-timeout";

import { type FlushResult } from "./autosave-controller";

/** A preview link request that has not answered after 15 s is aborted and reported as failed. */
export const PREVIEW_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export type PreviewOutcome =
  | Readonly<{ kind: "blocked" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "gone" }>
  | Readonly<{ kind: "open"; url: string }>
  | Readonly<{ kind: "rate-limited"; retryAfterSeconds: number | null }>;

export type RequestPreviewInput = Readonly<{
  fetch?: typeof fetch;
  flush: () => Promise<FlushResult>;
  publicId: string;
  /** Funnel analytics: called with `preview_started` just before `open` is returned. */
  report?: (name: "preview_started") => void;
}>;

/** Opens the preview in this tab; a new tab would be a blocked popup after an `await`. */
export function navigateToPreview(url: string): void {
  window.location.assign(url);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * `Xem trước`: settles pending saves first, and requests a preview link only when the draft is
 * saved. It never rejects and never logs: the returned URL holds a bearer token.
 */
export async function requestPreview({
  fetch: fetchImpl = fetch,
  flush,
  publicId,
  report = () => undefined,
}: RequestPreviewInput): Promise<PreviewOutcome> {
  const flushed = await flush();
  // The save status, invalid-content message or conflict banner already shows why.
  if (flushed.kind !== "saved") return { kind: "blocked" };

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `/api/gifts/${encodeURIComponent(publicId)}/preview`,
      { body: "{}", headers: { "Content-Type": "application/json" }, method: "POST" },
      PREVIEW_REQUEST_TIMEOUT_MILLISECONDS,
    );
  } catch {
    return { kind: "failed" };
  }

  const payload = await readJson(response);
  switch (response.status) {
    case 201: {
      const parsed = GiftPreviewLinkResponseSchema.safeParse(payload);
      if (!parsed.success) return { kind: "failed" };
      // Fire-and-forget with `keepalive`: it survives the navigation to the preview that follows.
      report("preview_started");
      return { kind: "open", url: parsed.data.data.url };
    }
    case 404:
      return { kind: "gone" };
    case 429: {
      const error = ApiErrorResponseSchema.safeParse(payload);
      const retryAfterSeconds = error.success
        ? error.data.error.details?.["retryAfterSeconds"]
        : null;
      return {
        kind: "rate-limited",
        retryAfterSeconds: typeof retryAfterSeconds === "number" ? retryAfterSeconds : null,
      };
    }
    default:
      return { kind: "failed" };
  }
}
