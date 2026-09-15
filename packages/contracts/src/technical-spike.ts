import { z } from "zod";

import { createApiSuccessSchema } from "./api";

export const MongoSpikeDataSchema = z
  .object({
    connectionReused: z.literal(true),
    readVerified: z.literal(true),
    writeVerified: z.literal(true),
  })
  .strict();

export const MongoSpikeResponseSchema = createApiSuccessSchema(MongoSpikeDataSchema);
