import "server-only";

import { z } from "zod";

// This module reads the environment only: no filesystem, crypto or provider SDK imports. The proxy
// and the template artifact route use it on every request to build Content Security Policy.

export const STORAGE_DRIVERS = ["vercel-blob", "local"] as const;

export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

/** The same-origin route that serves signed local object URLs. */
export const LOCAL_OBJECT_ROUTE_PATH = "/api/local-object-storage/";

/** Configuration errors name the offending variables only, never their values. */
export class StorageConfigurationError extends Error {
  override readonly name = "StorageConfigurationError";
}

type Source = Readonly<Record<string, string | undefined>>;

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const StorageDriverSchema = z.preprocess(emptyAsUndefined, z.enum(STORAGE_DRIVERS).optional());

// One pure rule set shared by the configuration parser and the CSP origin lookup, so a refused or
// misconfigured local driver can never add a policy origin.
const LocalStorageSettingsSchema = z.object({
  APP_URL: z
    .string("APP_URL is required for the local storage driver.")
    .refine((value) => URL.canParse(value), "APP_URL must be an absolute URL.")
    .refine(
      (value) => !URL.canParse(value) || ["http:", "https:"].includes(new URL(value).protocol),
      "APP_URL must be an HTTP(S) URL.",
    ),
  LOCAL_OBJECT_STORAGE_SECRET: z
    .string("LOCAL_OBJECT_STORAGE_SECRET is required for the local storage driver.")
    .min(32, "LOCAL_OBJECT_STORAGE_SECRET must have at least 32 characters.")
    .max(256, "LOCAL_OBJECT_STORAGE_SECRET must have at most 256 characters."),
  // Anything but an unset, empty or development VERCEL_ENV is a Vercel deployment: fail closed.
  VERCEL_ENV: z.preprocess(
    emptyAsUndefined,
    z
      .literal("development", "The local storage driver is refused on Vercel deployments.")
      .optional(),
  ),
});

type LocalStorageSettings = Readonly<{ publicOrigin: string; signingSecret: string }>;

export function readStorageDriver(source: Source): StorageDriver {
  const driver = StorageDriverSchema.safeParse(source["STORAGE_DRIVER"]);
  if (!driver.success) {
    throw new StorageConfigurationError("STORAGE_DRIVER must be vercel-blob or local.");
  }
  return driver.data ?? "vercel-blob";
}

export function readLocalStorageSettings(source: Source): LocalStorageSettings {
  const settings = LocalStorageSettingsSchema.safeParse({
    APP_URL: source["APP_URL"],
    LOCAL_OBJECT_STORAGE_SECRET: source["LOCAL_OBJECT_STORAGE_SECRET"],
    VERCEL_ENV: source["VERCEL_ENV"],
  });
  if (!settings.success) {
    throw new StorageConfigurationError(
      settings.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  return {
    publicOrigin: new URL(settings.data.APP_URL).origin,
    signingSecret: settings.data.LOCAL_OBJECT_STORAGE_SECRET,
  };
}

/**
 * The origin that local object URLs use, for Content Security Policy. It reads the environment
 * only (no filesystem access) and never throws, because the proxy calls it on every request.
 */
export function getLocalObjectStorageOrigin(source: Source): string | undefined {
  try {
    return readStorageDriver(source) === "local"
      ? readLocalStorageSettings(source).publicOrigin
      : undefined;
  } catch {
    return undefined;
  }
}
