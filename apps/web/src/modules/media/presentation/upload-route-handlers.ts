import {
  API_ERROR_CODES,
  UploadCleanupRequestSchema,
  UploadCompleteRequestSchema,
  UploadInitRequestSchema,
} from "@love-memory/contracts";
import {
  ImageTooLargeError,
  InvalidImageError,
  UnsupportedImageFormatError,
} from "@love-memory/media";

import { type TechnicalSpikeEnvironment } from "@/config/technical-spikes";
import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
} from "@/http/api-response";
import { getTechnicalSpikeAccessFailure } from "@/http/technical-spike-response";
import {
  type MediaSpikeService,
  UploadVerificationError,
} from "@/modules/media/application/media-spike-service";
import { reportOperationalFailure } from "@/observability/operational-errors";

export type UploadRouteDependencies = Readonly<{
  environment: TechnicalSpikeEnvironment;
  getService: () => MediaSpikeService;
  reportFailure?: typeof reportOperationalFailure;
}>;

function isSafeUploadFailure(error: unknown): boolean {
  return (
    error instanceof UploadVerificationError ||
    error instanceof ImageTooLargeError ||
    error instanceof InvalidImageError ||
    error instanceof UnsupportedImageFormatError
  );
}

export async function handleCleanupUpload(
  request: Request,
  { environment, getService, reportFailure = reportOperationalFailure }: UploadRouteDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const authorizationFailure = getTechnicalSpikeAccessFailure(request, environment, requestId);

  if (authorizationFailure) {
    return authorizationFailure;
  }

  const body = await readJsonBody(request, UploadCleanupRequestSchema);

  if (!body.ok) {
    return createInvalidBodyResponse(body.error, requestId);
  }

  try {
    const data = await getService().cleanupUpload(body.data);
    return createApiSuccessResponse(data, requestId);
  } catch (error) {
    reportFailure("media.cleanup-upload", error, requestId);
    return createApiErrorResponse({
      code: API_ERROR_CODES.unavailable,
      message: "Media cleanup is not available.",
      requestId,
      status: 503,
    });
  }
}

export async function handleInitializeUpload(
  request: Request,
  { environment, getService, reportFailure = reportOperationalFailure }: UploadRouteDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const authorizationFailure = getTechnicalSpikeAccessFailure(request, environment, requestId);

  if (authorizationFailure) {
    return authorizationFailure;
  }

  const body = await readJsonBody(request, UploadInitRequestSchema);

  if (!body.ok) {
    return createInvalidBodyResponse(body.error, requestId);
  }

  try {
    const data = await getService().initializeUpload(body.data);
    return createApiSuccessResponse(data, requestId, 201);
  } catch (error) {
    reportFailure("media.initialize-upload", error, requestId);
    return createApiErrorResponse({
      code: API_ERROR_CODES.unavailable,
      message: "Upload storage is not configured or available.",
      requestId,
      status: 503,
    });
  }
}

export async function handleCompleteUpload(
  request: Request,
  { environment, getService, reportFailure = reportOperationalFailure }: UploadRouteDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const authorizationFailure = getTechnicalSpikeAccessFailure(request, environment, requestId);

  if (authorizationFailure) {
    return authorizationFailure;
  }

  const body = await readJsonBody(request, UploadCompleteRequestSchema);

  if (!body.ok) {
    return createInvalidBodyResponse(body.error, requestId);
  }

  try {
    const data = await getService().completeUpload(body.data);
    return createApiSuccessResponse(data, requestId);
  } catch (error) {
    reportFailure("media.complete-upload", error, requestId);

    if (isSafeUploadFailure(error)) {
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        message: "Uploaded object failed media validation.",
        requestId,
        status: 422,
      });
    }

    return createApiErrorResponse({
      code: API_ERROR_CODES.unavailable,
      message: "Media processing is not available.",
      requestId,
      status: 503,
    });
  }
}
