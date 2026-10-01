import { randomUUID } from "node:crypto";

import { API_ERROR_CODES } from "@love-memory/contracts";
import {
  type LocalObjectStorage,
  type LocalObjectVerification,
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  parseObjectKey,
  StoredObjectTooLargeError,
} from "@love-memory/storage";

import { createApiErrorResponse } from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

export type LocalObjectRouteDependencies = Readonly<{
  /** The local store, or `null` whenever the effective storage driver is not `local`. */
  getStorage: () => LocalObjectStorage | null;
  reportFailure?: typeof reportOperationalFailure;
}>;

type Authorized = Readonly<{
  key: string;
  storage: LocalObjectStorage;
  verification: Exclude<LocalObjectVerification, { ok: false }>;
}>;

const DOWNLOAD_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
} as const;

// Error messages are fixed strings: no key, signature, secret or filesystem path is ever echoed.
function errorResponse(id: string, status: 403 | 404 | 409 | 413 | 415 | 500): Response {
  switch (status) {
    case 403:
      return createApiErrorResponse({
        code: API_ERROR_CODES.forbidden,
        message: "The storage URL is invalid or has expired.",
        requestId: id,
        status,
      });
    case 404:
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "The object was not found.",
        requestId: id,
        status,
      });
    case 409:
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        message: "An object already exists at this location.",
        requestId: id,
        status,
      });
    case 413:
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        message: "The upload exceeds the permitted size.",
        requestId: id,
        status,
      });
    case 415:
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        message: "The upload content type does not match the grant.",
        requestId: id,
        status,
      });
    case 500:
      return createApiErrorResponse({
        code: API_ERROR_CODES.internal,
        message: "The storage operation could not be completed.",
        requestId: id,
        status,
      });
  }
}

function withoutBodyForHead(request: Request, response: Response): Response {
  return request.method === "HEAD"
    ? new Response(null, { headers: response.headers, status: response.status })
    : response;
}

// Check order: inactive driver → 404, invalid key → 404, then signature/method/expiry → 403.
// Nothing touches the filesystem before all three checks pass.
function authorize(
  request: Request,
  segments: readonly string[],
  getStorage: () => LocalObjectStorage | null,
  id: string,
): Authorized | Response {
  const storage = getStorage();
  if (!storage) return errorResponse(id, 404);
  const key = parseObjectKey(segments.join("/"));
  if (!key) return errorResponse(id, 404);
  const verification = storage.verifyRequest({
    key,
    method: request.method,
    parameters: new URL(request.url).searchParams,
  });
  if (!verification.ok) return errorResponse(id, 403);
  return { key, storage, verification };
}

function mediaType(value: string | null): string | undefined {
  return value?.split(";", 1)[0]?.trim().toLowerCase();
}

export async function handleLocalObjectDownload(
  request: Request,
  segments: readonly string[],
  { getStorage, reportFailure = reportOperationalFailure }: LocalObjectRouteDependencies,
): Promise<Response> {
  const id = randomUUID();
  try {
    const authorized = authorize(request, segments, getStorage, id);
    if (authorized instanceof Response) return withoutBodyForHead(request, authorized);
    // URLs are signed only for GET or PUT, so HEAD never gets here; refuse it without a file.
    if (request.method !== "GET" || authorized.verification.method !== "GET") {
      return withoutBodyForHead(request, errorResponse(id, 403));
    }
    let object: Awaited<ReturnType<LocalObjectStorage["openObject"]>>;
    try {
      object = await authorized.storage.openObject(authorized.key);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return errorResponse(id, 404);
      throw error;
    }
    return new Response(object.body, {
      headers: {
        ...DOWNLOAD_HEADERS,
        "Content-Length": String(object.metadata.contentLength),
        "Content-Type": object.metadata.contentType,
        "x-request-id": id,
      },
      status: 200,
    });
  } catch (error) {
    reportFailure("local_object_storage_download_failed", error, id);
    return withoutBodyForHead(request, errorResponse(id, 500));
  }
}

export async function handleLocalObjectUpload(
  request: Request,
  segments: readonly string[],
  { getStorage, reportFailure = reportOperationalFailure }: LocalObjectRouteDependencies,
): Promise<Response> {
  const id = randomUUID();
  try {
    const authorized = authorize(request, segments, getStorage, id);
    if (authorized instanceof Response) return authorized;
    const { key, storage, verification } = authorized;
    if (verification.method !== "PUT") return errorResponse(id, 403);
    if (mediaType(request.headers.get("content-type")) !== verification.contentType) {
      return errorResponse(id, 415);
    }
    const declaredLength = request.headers.get("content-length");
    if (
      declaredLength !== null &&
      /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > verification.maxBytes
    ) {
      return errorResponse(id, 413);
    }
    if (await storage.hasObject(key)) return errorResponse(id, 409);
    try {
      await storage.writeUpload({
        body: request.body,
        contentType: verification.contentType,
        key,
        maximumBytes: verification.maxBytes,
      });
    } catch (error) {
      if (error instanceof StoredObjectTooLargeError) return errorResponse(id, 413);
      if (error instanceof ObjectAlreadyExistsError) return errorResponse(id, 409);
      throw error;
    }
    return new Response(null, {
      headers: { "Cache-Control": "no-store", "x-request-id": id },
      status: 204,
    });
  } catch (error) {
    reportFailure("local_object_storage_upload_failed", error, id);
    return errorResponse(id, 500);
  }
}
