import { createHash, randomBytes } from "node:crypto";

/** A preview link is valid for 30 minutes after issuance. */
export const PREVIEW_TOKEN_TTL_SECONDS = 1800;

const PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as unpadded base64url: 43 characters, 256 bits. */
export function generatePreviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The stored form of a token: lowercase hex SHA-256. A plain hash is enough because the input is
 * uniformly random; a keyed hash would add nothing.
 */
export function hashPreviewToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Checked before any database access. */
export function isPreviewTokenFormat(token: string): boolean {
  return PREVIEW_TOKEN_PATTERN.test(token);
}
