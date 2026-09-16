import { API_ERROR_CODES, type ApiErrorCode } from "@love-memory/contracts";
import { failure, type Result, success } from "@love-memory/shared";
import { type z } from "zod";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export type RequestBodyFailure = Readonly<{
  fieldErrors?: Readonly<Record<string, string>>;
  kind: "invalid-json" | "validation";
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

export async function readJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<Result<z.output<TSchema>, RequestBodyFailure>> {
  let body: unknown;

  try {
    body = await request.json();
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

export function createInvalidBodyResponse(
  failureReason: RequestBodyFailure,
  requestId: string,
): Response {
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
