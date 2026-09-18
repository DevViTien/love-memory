import {
  API_ERROR_CODES,
  MediaAssetIdSchema,
  MediaAssetMutationRequestSchema,
  MediaUploadCompleteRequestSchema,
  MediaUploadInitRequestSchema,
  PublicGiftIdSchema,
} from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "@/http/api-response";
import {
  type MediaService,
  type MediaServiceError,
} from "@/modules/media/application/media-service";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";
import { reportOperationalFailure } from "@/observability/operational-errors";

export type MediaRouteDependencies = Readonly<{
  getService: () => MediaService;
  reportFailure?: typeof reportOperationalFailure;
  scheduleProcessing?: () => Promise<void> | void;
}>;

function errorResponse(error: MediaServiceError, id: string): Response {
  switch (error.code) {
    case "NOT_FOUND":
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Media asset was not found.",
        requestId: id,
        status: 404,
      });
    case "INVALID_FIELD":
    case "UPLOAD_INVALID":
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        message:
          error.code === "INVALID_FIELD"
            ? "This template field does not accept uploaded images."
            : "The uploaded object did not match its declaration.",
        requestId: id,
        status: 422,
      });
    case "QUOTA_EXCEEDED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.rateLimited,
        message: "The media limit for this gift has been reached.",
        requestId: id,
        status: 429,
      });
    case "INVALID_STATE":
    case "RETRY_EXHAUSTED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        message:
          error.code === "RETRY_EXHAUSTED"
            ? "This asset reached the retry limit."
            : "The asset is not in a state that allows this operation.",
        requestId: id,
        status: 409,
      });
  }
}

function internalError(
  event: string,
  error: unknown,
  id: string,
  reportFailure: typeof reportOperationalFailure,
) {
  reportFailure(event, error, id);
  return createApiErrorResponse({
    code: API_ERROR_CODES.internal,
    message: "The media operation could not be completed.",
    requestId: id,
    status: 500,
  });
}

export async function handleInitializeMediaUpload(
  request: Request,
  { getService, reportFailure = reportOperationalFailure }: MediaRouteDependencies,
): Promise<Response> {
  const id = requestId(request);
  try {
    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;
    const context = await getGiftRequestContext(request);
    const limited = await enforceGiftMutationRateLimit(request, context, "media-upload", id);
    if (limited) return limited;
    const body = await readJsonBody(request, MediaUploadInitRequestSchema);
    if (!body.ok) return createInvalidBodyResponse(body.error, id);
    const result = await getService().initializeUpload({
      accessors: context.accessors,
      contentType: body.data.contentType,
      fieldId: body.data.fieldId,
      giftPublicId: body.data.giftPublicId,
      sizeBytes: body.data.sizeBytes,
    });
    return result.ok
      ? createApiSuccessResponse(result.data, id, 201)
      : errorResponse(result.error, id);
  } catch (error) {
    return internalError("media_upload_initialize_failed", error, id, reportFailure);
  }
}

export async function handleCompleteMediaUpload(
  request: Request,
  {
    getService,
    reportFailure = reportOperationalFailure,
    scheduleProcessing,
  }: MediaRouteDependencies,
): Promise<Response> {
  const id = requestId(request);
  try {
    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;
    const body = await readJsonBody(request, MediaUploadCompleteRequestSchema);
    if (!body.ok) return createInvalidBodyResponse(body.error, id);
    const context = await getGiftRequestContext(request);
    const result = await getService().completeUpload({
      accessors: context.accessors,
      ...body.data,
    });
    if (!result.ok) return errorResponse(result.error, id);
    try {
      await scheduleProcessing?.();
    } catch (error) {
      reportFailure("media_worker_dispatch_failed", error, id);
    }
    return createApiSuccessResponse(result.data, id, 202);
  } catch (error) {
    return internalError("media_upload_complete_failed", error, id, reportFailure);
  }
}

export async function handleListMediaAssets(
  request: Request,
  { getService, reportFailure = reportOperationalFailure }: MediaRouteDependencies,
): Promise<Response> {
  const id = requestId(request);
  try {
    const url = new URL(request.url);
    const publicId = PublicGiftIdSchema.safeParse(url.searchParams.get("giftPublicId"));
    if (!publicId.success) {
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        message: "giftPublicId is required.",
        requestId: id,
        status: 400,
      });
    }
    const context = await getGiftRequestContext(request);
    const result = await getService().listAssets({
      accessors: context.accessors,
      giftPublicId: publicId.data,
      includeDownloadUrls: url.searchParams.get("includeDownloadUrls") !== "false",
    });
    return result.ok
      ? createApiSuccessResponse({ assets: result.data }, id)
      : errorResponse(result.error, id);
  } catch (error) {
    return internalError("media_asset_list_failed", error, id, reportFailure);
  }
}

export async function handleGetMediaAsset(
  request: Request,
  assetIdInput: string,
  { getService, reportFailure = reportOperationalFailure }: MediaRouteDependencies,
): Promise<Response> {
  const id = requestId(request);
  try {
    const assetId = MediaAssetIdSchema.safeParse(assetIdInput);
    const publicId = PublicGiftIdSchema.safeParse(
      new URL(request.url).searchParams.get("giftPublicId"),
    );
    if (!assetId.success || !publicId.success) {
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Media asset was not found.",
        requestId: id,
        status: 404,
      });
    }
    const context = await getGiftRequestContext(request);
    const result = await getService().getAsset({
      accessors: context.accessors,
      assetId: assetId.data,
      giftPublicId: publicId.data,
    });
    return result.ok ? createApiSuccessResponse(result.data, id) : errorResponse(result.error, id);
  } catch (error) {
    return internalError("media_asset_read_failed", error, id, reportFailure);
  }
}

async function handleAssetMutation(
  request: Request,
  assetIdInput: string,
  dependencies: MediaRouteDependencies,
  operation: "delete" | "retry",
): Promise<Response> {
  const id = requestId(request);
  try {
    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;
    const assetId = MediaAssetIdSchema.safeParse(assetIdInput);
    const body = await readJsonBody(request, MediaAssetMutationRequestSchema);
    if (!assetId.success || !body.ok) {
      return !body.ok
        ? createInvalidBodyResponse(body.error, id)
        : createApiErrorResponse({
            code: API_ERROR_CODES.notFound,
            message: "Media asset was not found.",
            requestId: id,
            status: 404,
          });
    }
    const context = await getGiftRequestContext(request);
    const input = {
      accessors: context.accessors,
      assetId: assetId.data,
      giftPublicId: body.data.giftPublicId,
    };
    const result =
      operation === "delete"
        ? await dependencies.getService().deleteAsset(input)
        : await dependencies.getService().retryAsset(input);
    if (!result.ok) return errorResponse(result.error, id);
    if (operation === "retry") {
      try {
        await dependencies.scheduleProcessing?.();
      } catch (error) {
        (dependencies.reportFailure ?? reportOperationalFailure)(
          "media_worker_dispatch_failed",
          error,
          id,
        );
      }
    }
    return createApiSuccessResponse(result.data, id);
  } catch (error) {
    return internalError(
      `media_asset_${operation}_failed`,
      error,
      id,
      dependencies.reportFailure ?? reportOperationalFailure,
    );
  }
}

export function handleDeleteMediaAsset(
  request: Request,
  assetId: string,
  dependencies: MediaRouteDependencies,
) {
  return handleAssetMutation(request, assetId, dependencies, "delete");
}

export function handleRetryMediaAsset(
  request: Request,
  assetId: string,
  dependencies: MediaRouteDependencies,
) {
  return handleAssetMutation(request, assetId, dependencies, "retry");
}
