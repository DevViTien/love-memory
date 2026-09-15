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
  fieldErrors,
  message,
  requestId,
  status,
}: Readonly<{
  code: ApiErrorCode;
  fieldErrors?: Readonly<Record<string, string>>;
  message: string;
  requestId: string;
  status: number;
}>): Response {
  return Response.json(
    {
      error: {
        code,
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
