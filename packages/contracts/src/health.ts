import { z } from "zod";

export const HealthStatusSchema = z
  .object({
    service: z.string().min(1),
    status: z.literal("ok"),
    timestamp: z.string().datetime(),
    version: z.string().min(1),
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    data: HealthStatusSchema,
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
