import { API_ERROR_CODES, type ApiErrorCode } from "@love-memory/contracts";
import { failure, type Result, success } from "@love-memory/shared";
import { type z } from "zod";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export type RequestBodyFailure = Readonly<{
  fieldErrors?: Readonly<Record<string, string>>;
  kind: "invalid-json" | "too-large" | "validation";
}>;

export type ReadJsonBodyOptions = Readonly<{
  /** The largest accepted body in bytes, checked on `Content-Length` and while reading. */
  maxBytes?: number;
}>;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function effectiveRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const forwardedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : requestUrl.protocol.slice(0, -1);
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  return normalizeHttpOrigin(`${protocol}://${host}`);
}

export function validateJsonMutationRequest(request: Request, requestId: string): Response | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.validation,
      message: "Content-Type must be application/json.",
      requestId,
      status: 415,
    });
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.forbidden,
      message: "Cross-origin mutation requests are not allowed.",
      requestId,
      status: 403,
    });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const normalizedOrigin = normalizeHttpOrigin(origin);
    if (normalizedOrigin && normalizedOrigin === effectiveRequestOrigin(request)) {
      return null;
    }
    return createApiErrorResponse({
      code: API_ERROR_CODES.forbidden,
      message: "The request origin is not trusted.",
      requestId,
      status: 403,
    });
  }

  return null;
}

/**
 * Reads at most `maxBytes` of the body: a larger declared `Content-Length` is refused without
 * reading, and a stream that grows past the cap is cancelled. `null` means the body was too large.
 */
async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  options: ReadJsonBodyOptions = {},
): Promise<Result<z.output<TSchema>, RequestBodyFailure>> {
  let body: unknown;

  try {
    if (options.maxBytes === undefined) {
      body = await request.json();
    } else {
      const text = await readCappedText(request, options.maxBytes);
      if (text === null) return failure({ kind: "too-large" });
      body = JSON.parse(text);
    }
  } catch {
    return failure({ kind: "invalid-json" });
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return failure({
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "body", issue.message]),
      ),
      kind: "validation",
    });
  }

  return success(parsed.data);
}

export function createApiErrorResponse({
  code,
  details,
  fieldErrors,
  message,
  requestId,
  status,
}: Readonly<{
  code: ApiErrorCode;
  details?: Readonly<Record<string, boolean | number | string>>;
  fieldErrors?: Readonly<Record<string, string>>;
  message: string;
  requestId: string;
  status: number;
}>): Response {
  return Response.json(
    {
      error: {
        code,
        ...(details ? { details } : {}),
        ...(fieldErrors ? { fieldErrors } : {}),
        message,
        requestId,
      },
    },
    { headers: { ...noStoreHeaders, "x-request-id": requestId }, status },
  );
}

/** The caller's `x-request-id` when it is at most 128 characters, otherwise a new UUID. */
export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
}

/** `429 RATE_LIMITED` with `details.retryAfterSeconds` and a matching `Retry-After` header. */
export function createRateLimitedResponse(retryAfterSeconds: number, requestId: string): Response {
  const response = createApiErrorResponse({
    code: API_ERROR_CODES.rateLimited,
    details: { retryAfterSeconds },
    message: "Too many requests. Please try again later.",
    requestId,
    status: 429,
  });
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export function createPayloadTooLargeResponse(requestId: string): Response {
  return createApiErrorResponse({
    code: API_ERROR_CODES.validation,
    message: "Request body is too large.",
    requestId,
    status: 413,
  });
}

export function createInvalidBodyResponse(
  failureReason: RequestBodyFailure,
  requestId: string,
): Response {
  if (failureReason.kind === "too-large") return createPayloadTooLargeResponse(requestId);
  return createApiErrorResponse({
    code: API_ERROR_CODES.validation,
    ...(failureReason.fieldErrors ? { fieldErrors: failureReason.fieldErrors } : {}),
    message:
      failureReason.kind === "invalid-json"
        ? "Request body must be valid JSON."
        : "Request body validation failed.",
    requestId,
    status: 400,
  });
}

export function createApiSuccessResponse<T>(data: T, requestId: string, status = 200): Response {
  return Response.json(
    { data },
    { headers: { ...noStoreHeaders, "x-request-id": requestId }, status },
  );
}
