import "server-only";

import { z } from "zod";

const optionalSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const StorageEnvironmentSchema = z
  .object({
    BLOB_READ_WRITE_TOKEN: optionalSecretSchema,
    BLOB_STORE_ID: optionalSecretSchema,
    VERCEL_OIDC_TOKEN: optionalSecretSchema,
  })
  .superRefine((environment, context) => {
    const hasStaticToken = environment.BLOB_READ_WRITE_TOKEN !== undefined;
    const hasOidcToken = environment.VERCEL_OIDC_TOKEN !== undefined;
    const hasStoreId = environment.BLOB_STORE_ID !== undefined;

    if (!hasStaticToken && !hasStoreId) {
      context.addIssue({
        code: "custom",
        message: "Configure BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID.",
      });
    }

    if (hasOidcToken && !hasStoreId) {
      context.addIssue({
        code: "custom",
        message: "BLOB_STORE_ID is required when VERCEL_OIDC_TOKEN is configured.",
      });
    }
  })
  .transform((environment) => {
    if (environment.BLOB_STORE_ID && environment.VERCEL_OIDC_TOKEN) {
      // Do not pass VERCEL_OIDC_TOKEN explicitly. The Blob SDK resolves a local
      // token from the environment, where it can be rotated automatically.
      return { storeId: environment.BLOB_STORE_ID } as const;
    }

    if (environment.BLOB_READ_WRITE_TOKEN) {
      // Non-Vercel runtimes such as Trigger.dev do not have a Vercel request
      // context. Prefer the explicit token there, even when a store id was
      // synchronized alongside it.
      return { token: environment.BLOB_READ_WRITE_TOKEN } as const;
    }

    // On Vercel, the SDK resolves the rotating OIDC token from request context.
    return { storeId: environment.BLOB_STORE_ID! } as const;
  });

export type StorageEnvironment = z.output<typeof StorageEnvironmentSchema>;

export function parseStorageEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): StorageEnvironment {
  return StorageEnvironmentSchema.parse(source);
}

export function getStorageEnvironment(): StorageEnvironment {
  return parseStorageEnvironment(process.env);
}
