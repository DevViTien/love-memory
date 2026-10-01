import { ApiErrorResponseSchema, type ApiError } from "@love-memory/contracts";

/** The media request a refusal answered; the same code means different things per operation. */
export type MediaOperation = "complete" | "delete" | "init" | "list" | "retry";

export type MediaRequestFailure = Readonly<{
  code: ApiError["code"] | null;
  /** Whether the response carried `Retry-After` (a rate limit, not the gift's image quota). */
  retryAfter: boolean;
  status: number;
}>;

export const MEDIA_ERROR_MESSAGES = {
  busy: "Hệ thống đang bận. Hãy thử lại sau ít phút.",
  completeConflict: "Ảnh này không thể hoàn tất tải lên nữa. Hãy xóa và chọn lại ảnh.",
  completeInvalid: "Ảnh tải lên bị lỗi hoặc không đầy đủ. Hãy xóa và chọn lại ảnh này.",
  crop: "Không cắt được ảnh này — hãy thử lại hoặc chọn ảnh khác.",
  deleteConflict: "Ảnh đang được cập nhật — hãy thử xóa lại sau giây lát.",
  forbidden: "Bạn không có quyền thay đổi ảnh của món quà này.",
  generic: "Chưa thực hiện được thao tác với ảnh — thử lại.",
  initInvalid: "Ảnh này không được hỗ trợ. Hãy chọn ảnh JPEG, PNG hoặc WebP dưới 10 MB.",
  notFound: "Không tìm thấy món quà hoặc ảnh này nữa. Hãy tải lại trang.",
  quota: "Món quà đã đạt giới hạn số ảnh.",
  rateLimited: "Bạn đang tải ảnh hơi nhanh. Hãy thử lại sau ít phút.",
  retryConflict: "Ảnh này không thể xử lý lại nữa. Hãy xóa và chọn lại ảnh.",
} as const;

/** Reads the status, error code and `Retry-After` of a refused media response; never its text. */
export function readMediaFailure(response: Response, payload: unknown): MediaRequestFailure {
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  return {
    code: parsed.success ? parsed.data.error.code : null,
    retryAfter: response.headers.has("retry-after"),
    status: response.status,
  };
}

/**
 * Vietnamese copy for a refused media request. The server's own message is English and written for
 * engineers, so it is never shown; only the operation, status and error code choose the text.
 */
export function mediaErrorMessage(operation: MediaOperation, failure: MediaRequestFailure): string {
  const { code, retryAfter, status } = failure;
  if (code === "INTERNAL_ERROR" || code === "SERVICE_UNAVAILABLE" || status >= 500) {
    return MEDIA_ERROR_MESSAGES.busy;
  }
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return MEDIA_ERROR_MESSAGES.forbidden;
  if (code === "NOT_FOUND") return MEDIA_ERROR_MESSAGES.notFound;
  if (code === "RATE_LIMITED") {
    if (operation !== "init" || retryAfter) return MEDIA_ERROR_MESSAGES.rateLimited;
    return MEDIA_ERROR_MESSAGES.quota;
  }
  if (code === "VALIDATION_ERROR") {
    if (operation === "init") return MEDIA_ERROR_MESSAGES.initInvalid;
    if (operation === "complete") return MEDIA_ERROR_MESSAGES.completeInvalid;
  }
  if (code === "CONFLICT") {
    if (operation === "complete") return MEDIA_ERROR_MESSAGES.completeConflict;
    if (operation === "delete") return MEDIA_ERROR_MESSAGES.deleteConflict;
    if (operation === "retry") return MEDIA_ERROR_MESSAGES.retryConflict;
  }
  return MEDIA_ERROR_MESSAGES.generic;
}

/** A refused media request, carrying only what is needed to choose Vietnamese copy. */
export class MediaRequestError extends Error {
  readonly failure: MediaRequestFailure;
  readonly operation: MediaOperation;

  constructor(operation: MediaOperation, failure: MediaRequestFailure) {
    super(mediaErrorMessage(operation, failure));
    this.name = "MediaRequestError";
    this.failure = failure;
    this.operation = operation;
  }
}
