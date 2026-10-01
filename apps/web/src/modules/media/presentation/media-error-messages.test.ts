import { describe, expect, it } from "vitest";

import {
  MEDIA_ERROR_MESSAGES,
  mediaErrorMessage,
  MediaRequestError,
  readMediaFailure,
  type MediaOperation,
  type MediaRequestFailure,
} from "./media-error-messages";

function failure(
  status: number,
  code: MediaRequestFailure["code"],
  retryAfter = false,
): MediaRequestFailure {
  return { code, retryAfter, status };
}

describe("media error messages", () => {
  it.each<[MediaOperation, MediaRequestFailure, string]>([
    ["init", failure(429, "RATE_LIMITED", true), MEDIA_ERROR_MESSAGES.rateLimited],
    ["init", failure(429, "RATE_LIMITED"), MEDIA_ERROR_MESSAGES.quota],
    ["retry", failure(429, "RATE_LIMITED"), MEDIA_ERROR_MESSAGES.rateLimited],
    ["init", failure(400, "VALIDATION_ERROR"), MEDIA_ERROR_MESSAGES.initInvalid],
    ["init", failure(422, "VALIDATION_ERROR"), MEDIA_ERROR_MESSAGES.initInvalid],
    ["complete", failure(422, "VALIDATION_ERROR"), MEDIA_ERROR_MESSAGES.completeInvalid],
    ["delete", failure(400, "VALIDATION_ERROR"), MEDIA_ERROR_MESSAGES.generic],
    ["complete", failure(409, "CONFLICT"), MEDIA_ERROR_MESSAGES.completeConflict],
    ["delete", failure(409, "CONFLICT"), MEDIA_ERROR_MESSAGES.deleteConflict],
    ["retry", failure(409, "CONFLICT"), MEDIA_ERROR_MESSAGES.retryConflict],
    ["list", failure(409, "CONFLICT"), MEDIA_ERROR_MESSAGES.generic],
    ["retry", failure(404, "NOT_FOUND"), MEDIA_ERROR_MESSAGES.notFound],
    ["init", failure(401, "UNAUTHORIZED"), MEDIA_ERROR_MESSAGES.forbidden],
    ["delete", failure(403, "FORBIDDEN"), MEDIA_ERROR_MESSAGES.forbidden],
    ["complete", failure(500, "INTERNAL_ERROR"), MEDIA_ERROR_MESSAGES.busy],
    ["init", failure(503, "SERVICE_UNAVAILABLE"), MEDIA_ERROR_MESSAGES.busy],
    ["delete", failure(502, null), MEDIA_ERROR_MESSAGES.busy],
    ["init", failure(418, null), MEDIA_ERROR_MESSAGES.generic],
  ])("maps %s %o to Vietnamese copy", (operation, input, expected) => {
    expect(mediaErrorMessage(operation, input)).toBe(expected);
  });

  it("reads the code and Retry-After but never the server message (Raw server message never shown)", () => {
    const payload = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body is invalid.",
        requestId: "r-1",
      },
    };
    const response = new Response(null, { headers: { "Retry-After": "30" }, status: 400 });

    const read = readMediaFailure(response, payload);
    expect(read).toEqual({ code: "VALIDATION_ERROR", retryAfter: true, status: 400 });
    expect(new MediaRequestError("init", read).message).toBe(MEDIA_ERROR_MESSAGES.initInvalid);
  });

  it("treats an unreadable body as an unknown code", () => {
    const read = readMediaFailure(new Response(null, { status: 409 }), "<html>");
    expect(read).toEqual({ code: null, retryAfter: false, status: 409 });
    const error = new MediaRequestError("complete", read);
    expect(error.name).toBe("MediaRequestError");
    expect(error.operation).toBe("complete");
    expect(error.failure.status).toBe(409);
    expect(error.message).toBe(MEDIA_ERROR_MESSAGES.generic);
  });
});
