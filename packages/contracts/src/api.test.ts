import { describe, expect, it } from "vitest";
import { z } from "zod";

import { API_ERROR_CODES, ApiErrorResponseSchema, createApiSuccessSchema } from "./api";

describe("API contracts", () => {
  it("builds a reusable success envelope", () => {
    const schema = createApiSuccessSchema(z.object({ id: z.string() }));

    expect(schema.parse({ data: { id: "gift-1" } })).toEqual({
      data: { id: "gift-1" },
    });
  });

  it("rejects unknown error codes", () => {
    const result = ApiErrorResponseSchema.safeParse({
      error: {
        code: "UNKNOWN",
        message: "Something happened",
        requestId: "request-1",
      },
    });

    expect(result.success).toBe(false);
    expect(API_ERROR_CODES.internal).toBe("INTERNAL_ERROR");
  });
});
