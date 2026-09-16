import { z } from "zod";

export const API_ERROR_CODES = {
  conflict: "CONFLICT",
  forbidden: "FORBIDDEN",
  internal: "INTERNAL_ERROR",
  notFound: "NOT_FOUND",
  rateLimited: "RATE_LIMITED",
  unavailable: "SERVICE_UNAVAILABLE",
  unauthorized: "UNAUTHORIZED",
  validation: "VALIDATION_ERROR",
} as const;

export const API_LIMITS = {
  requestIdMaxLength: 128,
} as const;

export const ApiErrorCodeSchema = z.enum([
  API_ERROR_CODES.conflict,
  API_ERROR_CODES.forbidden,
  API_ERROR_CODES.internal,
  API_ERROR_CODES.notFound,
  API_ERROR_CODES.rateLimited,
  API_ERROR_CODES.unavailable,
  API_ERROR_CODES.unauthorized,
  API_ERROR_CODES.validation,
]);

export const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
    message: z.string().min(1).max(300),
    requestId: z.string().min(1).max(API_LIMITS.requestIdMaxLength),
  })
  .strict();

export const ApiErrorResponseSchema = z
  .object({
    error: ApiErrorSchema,
  })
  .strict();

export function createApiSuccessSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z
    .object({
      data: dataSchema,
    })
    .strict();
}

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
