import "server-only";

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  readLocalStorageSettings,
  readStorageDriver,
  StorageConfigurationError,
} from "./local-object-origin";

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

export const LOCAL_OBJECT_STORAGE_DIRECTORY = join(".tmp", "object-storage");

export type StorageConfiguration =
  | Readonly<{ credentials: StorageEnvironment; driver: "vercel-blob" }>
  | Readonly<{
      driver: "local";
      publicOrigin: string;
      rootDirectory: string;
      signingSecret: string;
    }>;

type Source = Readonly<Record<string, string | undefined>>;

function issueMessages(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" ");
}

export function parseStorageConfiguration(
  source: Source,
  // A resolver keeps the Blob path free of filesystem access; only the local driver needs it.
  { workspaceRoot }: Readonly<{ workspaceRoot: string | (() => string) }>,
): StorageConfiguration {
  if (readStorageDriver(source) === "vercel-blob") {
    const credentials = StorageEnvironmentSchema.safeParse(source);
    if (!credentials.success) {
      throw new StorageConfigurationError(issueMessages(credentials.error));
    }
    return { credentials: credentials.data, driver: "vercel-blob" };
  }

  const settings = readLocalStorageSettings(source);
  const root = typeof workspaceRoot === "function" ? workspaceRoot() : workspaceRoot;
  return {
    driver: "local",
    publicOrigin: settings.publicOrigin,
    rootDirectory: join(root, LOCAL_OBJECT_STORAGE_DIRECTORY),
    signingSecret: settings.signingSecret,
  };
}

/** The nearest ancestor (or the directory itself) that contains `pnpm-workspace.yaml`. */
export function findWorkspaceRoot(startDirectory: string): string {
  let directory = resolve(startDirectory);
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new StorageConfigurationError("The repository workspace root was not found.");
    }
    directory = parent;
  }
  return directory;
}

export function getStorageConfiguration(): StorageConfiguration {
  return parseStorageConfiguration(process.env, {
    workspaceRoot: () => findWorkspaceRoot(process.cwd()),
  });
}
