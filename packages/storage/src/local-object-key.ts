import "server-only";

import { resolve, sep } from "node:path";

export const OBJECT_KEY_LIMITS = {
  maximumLength: 512,
  maximumSegmentLength: 128,
  maximumSegments: 16,
} as const;

// 1–128 characters from [A-Za-z0-9._-], not starting or ending with a dot. This excludes `.`,
// `..`, empty segments, `\`, `:` and `%`.
const SEGMENT_PATTERN = /^(?:[A-Za-z0-9_-]|[A-Za-z0-9_-][A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])$/;
// Windows reserves these device names with or without an extension, in any letter case.
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export class InvalidObjectKeyError extends Error {
  override readonly name = "InvalidObjectKeyError";
}

/** Returns the key when it satisfies the object key rules, otherwise `null`. */
export function parseObjectKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > OBJECT_KEY_LIMITS.maximumLength) return null;
  const segments = value.split("/");
  if (segments.length > OBJECT_KEY_LIMITS.maximumSegments) return null;
  const valid = segments.every(
    (segment) => SEGMENT_PATTERN.test(segment) && !RESERVED_DEVICE_NAME.test(segment),
  );
  return valid ? value : null;
}

/**
 * Resolves `key` (plus an optional file suffix) inside `directory`. Throws for an invalid key or a
 * path that would leave the directory, so callers never touch the filesystem for such keys.
 */
export function resolveObjectPath(directory: string, key: string, suffix = ""): string {
  const parsed = parseObjectKey(key);
  if (!parsed) throw new InvalidObjectKeyError("The object key is invalid.");
  const base = resolve(directory);
  const path = resolve(base, ...`${parsed}${suffix}`.split("/"));
  if (!path.startsWith(base + sep)) {
    throw new InvalidObjectKeyError("The object key is invalid.");
  }
  return path;
}
