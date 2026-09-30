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
    VERCEL_ENV: z.string().optional(),
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
    // Forced off rather than rejected: the proxy reads this on every request, so throwing would
    // take the whole Production site down. NODE_ENV cannot be used because local and CI E2E runs
    // also execute production builds.
    enabled: environment.TECHNICAL_SPIKES_ENABLED && environment.VERCEL_ENV !== "production",
    token: environment.TECHNICAL_SPIKE_TOKEN,
  }));

export type TechnicalSpikeEnvironment = z.output<typeof TechnicalSpikeEnvironmentSchema>;

export function isTechnicalSpikePagePath(pathname: string): boolean {
  return (
    pathname === "/studio/spikes" ||
    pathname.startsWith("/studio/spikes/") ||
    pathname === "/template-spikes" ||
    pathname.startsWith("/template-spikes/")
  );
}

export function parseTechnicalSpikeEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): TechnicalSpikeEnvironment {
  return TechnicalSpikeEnvironmentSchema.parse(source);
}

export function getTechnicalSpikeEnvironment(): TechnicalSpikeEnvironment {
  return parseTechnicalSpikeEnvironment(process.env);
}
