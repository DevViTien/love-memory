import "server-only";

import { z } from "zod";

const TechnicalSpikeEnvironmentSchema = z
  .object({
    TECHNICAL_SPIKES_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    TECHNICAL_SPIKE_TOKEN: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(24).max(256).optional(),
    ),
  })
  .superRefine((environment, context) => {
    if (environment.TECHNICAL_SPIKES_ENABLED && !environment.TECHNICAL_SPIKE_TOKEN) {
      context.addIssue({
        code: "custom",
        message: "TECHNICAL_SPIKE_TOKEN is required when technical spikes are enabled.",
        path: ["TECHNICAL_SPIKE_TOKEN"],
      });
    }
  })
  .transform((environment) => ({
    enabled: environment.TECHNICAL_SPIKES_ENABLED,
    token: environment.TECHNICAL_SPIKE_TOKEN,
  }));

export type TechnicalSpikeEnvironment = z.output<typeof TechnicalSpikeEnvironmentSchema>;

export function parseTechnicalSpikeEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): TechnicalSpikeEnvironment {
  return TechnicalSpikeEnvironmentSchema.parse(source);
}

export function getTechnicalSpikeEnvironment(): TechnicalSpikeEnvironment {
  return parseTechnicalSpikeEnvironment(process.env);
}
