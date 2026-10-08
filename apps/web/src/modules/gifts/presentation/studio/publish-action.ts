import {
  ApiErrorResponseSchema,
  type GiftPublicationDto,
  GiftPublicationResponseSchema,
} from "@love-memory/contracts";

import { fetchWithTimeout } from "@/http/fetch-with-timeout";

import { type FlushResult } from "./autosave-controller";

/**
 * A publish request that has not answered after 30 s is aborted and reported as failed. The retry
 * reuses the same `Idempotency-Key`, so a publish that did succeed is answered as its replay.
 */
export const PUBLISH_REQUEST_TIMEOUT_MILLISECONDS = 30_000;

export type PublishOutcome =
  | Readonly<{ kind: "access-unsupported" }>
  | Readonly<{ kind: "blocked" }>
  | Readonly<{ actualRevision: number; kind: "conflict" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "gone" }>
  | Readonly<{ fieldErrors: Readonly<Record<string, string>>; kind: "invalid" }>
  | Readonly<{ kind: "published"; publication: GiftPublicationDto }>
  | Readonly<{ kind: "rate-limited"; retryAfterSeconds: number | null }>
  | Readonly<{ kind: "reload" }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "unpublishable" }>;

export type RequestPublishInput = Readonly<{
  fetch?: typeof fetch;
  flush: () => Promise<FlushResult>;
  /** One UUID reused by every attempt until a `201`: keys are recorded only on success. */
  idempotencyKey: string;
  publicId: string;
}>;

const UNPUBLISHABLE_REASONS: readonly string[] = [
  "TEMPLATE_VERSION_NOT_EDITABLE",
  "TEMPLATE_VERSION_UNPUBLISHABLE",
];

/**
 * A `409` without details, or `NO_UNPUBLISHED_CHANGES`: the gift was published or updated
 * elsewhere, so the page reloads to show its current state.
 */
export function reloadStudioPage(): void {
  window.location.reload();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function classifyConflict(payload: unknown): PublishOutcome {
  const error = ApiErrorResponseSchema.safeParse(payload);
  if (!error.success) return { kind: "failed" };
  const details = error.data.error.details;
  if (!details) return { kind: "reload" };
  const actualRevision = details["actualRevision"];
  if (typeof actualRevision === "number") return { actualRevision, kind: "conflict" };
  const reason = details["reason"];
  if (typeof reason === "string" && UNPUBLISHABLE_REASONS.includes(reason)) {
    return { kind: "unpublishable" };
  }
  if (reason === "ACCESS_POLICY_UNSUPPORTED") return { kind: "access-unsupported" };
  if (reason === "NO_UNPUBLISHED_CHANGES") return { kind: "reload" };
  return { kind: "failed" };
}

/**
 * `Xuất bản` or `Cập nhật món quà`: settles pending saves first, then publishes the revision of
 * the last successful save. It never rejects and never logs.
 */
export async function requestPublish({
  fetch: fetchImpl = fetch,
  flush,
  idempotencyKey,
  publicId,
}: RequestPublishInput): Promise<PublishOutcome> {
  const flushed = await flush();
  // The save status, invalid-content message or conflict banner already shows why.
  if (flushed.kind !== "saved") return { kind: "blocked" };

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `/api/gifts/${encodeURIComponent(publicId)}/publish`,
      {
        body: JSON.stringify({ expectedRevision: flushed.revision }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        method: "POST",
      },
      PUBLISH_REQUEST_TIMEOUT_MILLISECONDS,
    );
  } catch {
    return { kind: "failed" };
  }

  const payload = await readJson(response);
  switch (response.status) {
    case 201: {
      const parsed = GiftPublicationResponseSchema.safeParse(payload);
      return parsed.success
        ? { kind: "published", publication: parsed.data.data.publication }
        : { kind: "failed" };
    }
    case 400: {
      const error = ApiErrorResponseSchema.safeParse(payload);
      const fieldErrors = error.success ? error.data.error.fieldErrors : undefined;
      return fieldErrors ? { fieldErrors, kind: "invalid" } : { kind: "failed" };
    }
    case 401:
      return { kind: "unauthenticated" };
    case 403:
      return { kind: "forbidden" };
    case 404:
      return { kind: "gone" };
    case 409:
      return classifyConflict(payload);
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
