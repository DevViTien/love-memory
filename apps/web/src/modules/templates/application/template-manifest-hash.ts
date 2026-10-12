import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, array order kept. Used to compare
 * and hash manifests independently of key order or SDK defaults.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `sha256(canonicalJson(manifest))`: the stored `contentHash` of a template version. */
export function manifestContentHash(manifest: unknown): string {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}
