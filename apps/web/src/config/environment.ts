import "server-only";

import { z } from "zod";

const optionalHttpUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "Expected an HTTP(S) URL.",
    })
    .optional(),
);

const WebEnvironmentSchema = z
  .object({
    APP_URL: optionalHttpUrlSchema,
    ASSET_ORIGIN: optionalHttpUrlSchema,
  })
  .transform((environment) => ({
    appUrl: environment.APP_URL ? new URL(environment.APP_URL) : undefined,
    assetOrigin: environment.ASSET_ORIGIN ? new URL(environment.ASSET_ORIGIN).origin : undefined,
  }));

export type WebEnvironment = z.output<typeof WebEnvironmentSchema>;

export function parseWebEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): WebEnvironment {
  return WebEnvironmentSchema.parse(source);
}

export function getWebEnvironment(): WebEnvironment {
  return parseWebEnvironment(process.env);
}
