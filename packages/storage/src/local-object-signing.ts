import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { parseObjectKey } from "./local-object-key";
import { LOCAL_OBJECT_ROUTE_PATH } from "./local-object-origin";

/** Upload types allowed by the media pipeline, plus the WebP derivative type. */
export const LOCAL_OBJECT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type LocalObjectContentType = (typeof LOCAL_OBJECT_CONTENT_TYPES)[number];

export type LocalObjectMethod = "GET" | "PUT";

const CANONICAL_VERSION = "lm-local-storage-v1";
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]{0,15}$/;

type SignedInput = Readonly<{
  contentType?: string;
  expires: number;
  key: string;
  maxBytes?: number;
  method: LocalObjectMethod;
}>;

function createSignature(secret: string, input: SignedInput): Buffer {
  const canonical = [
    CANONICAL_VERSION,
    input.method,
    input.key,
    String(input.expires),
    input.contentType ?? "",
    input.maxBytes === undefined ? "" : String(input.maxBytes),
  ].join("\n");
  return createHmac("sha256", secret).update(canonical, "utf8").digest();
}

export type SignLocalObjectUrlInput = Readonly<{
  expiresAt: Date;
  key: string;
  publicOrigin: string;
  secret: string;
}> &
  (
    | Readonly<{ method: "GET" }>
    | Readonly<{ contentType: LocalObjectContentType; maxBytes: number; method: "PUT" }>
  );

export function signLocalObjectUrl(input: SignLocalObjectUrlInput): string {
  const key = parseObjectKey(input.key);
  if (!key) throw new Error("Refusing to sign an invalid object key.");
  const expires = Math.floor(input.expiresAt.getTime() / 1000);
  const upload =
    input.method === "PUT" ? { contentType: input.contentType, maxBytes: input.maxBytes } : {};
  const signature = createSignature(input.secret, {
    ...upload,
    expires,
    key,
    method: input.method,
  });
  const url = new URL(
    LOCAL_OBJECT_ROUTE_PATH + key.split("/").map(encodeURIComponent).join("/"),
    input.publicOrigin,
  );
  url.searchParams.set("expires", String(expires));
  if (input.method === "PUT") {
    url.searchParams.set("contentType", input.contentType);
    url.searchParams.set("maxBytes", String(input.maxBytes));
  }
  url.searchParams.set("signature", signature.toString("base64url"));
  return url.toString();
}

export type LocalObjectVerification =
  | Readonly<{ method: "GET"; ok: true }>
  | Readonly<{ contentType: LocalObjectContentType; maxBytes: number; method: "PUT"; ok: true }>
  | Readonly<{ ok: false }>;

const REJECTED: LocalObjectVerification = { ok: false };

function singleParameter(parameters: URLSearchParams, name: string): string | null | undefined {
  const values = parameters.getAll(name);
  if (values.length > 1) return undefined;
  return values[0] ?? null;
}

function positiveInteger(value: string | null | undefined): number | null {
  if (!value || !POSITIVE_INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Verifies a request against its signed URL. The method comes from the HTTP request, so a URL
 * signed for one method never authorizes another. Every failure is the same opaque rejection.
 */
export function verifyLocalObjectRequest(
  input: Readonly<{
    key: string;
    method: string;
    now: Date;
    parameters: URLSearchParams;
    secret: string;
  }>,
): LocalObjectVerification {
  if (input.method !== "GET" && input.method !== "PUT") return REJECTED;
  const key = parseObjectKey(input.key);
  const expires = positiveInteger(singleParameter(input.parameters, "expires"));
  const signatureText = singleParameter(input.parameters, "signature");
  const contentTypeText = singleParameter(input.parameters, "contentType");
  const maxBytesText = singleParameter(input.parameters, "maxBytes");
  if (!key || expires === null || !signatureText || !SIGNATURE_PATTERN.test(signatureText)) {
    return REJECTED;
  }
  const provided = Buffer.from(signatureText, "base64url");
  if (provided.byteLength !== 32 || provided.toString("base64url") !== signatureText) {
    return REJECTED;
  }

  const accepted = (signed: SignedInput) =>
    timingSafeEqual(createSignature(input.secret, signed), provided) &&
    input.now.getTime() < expires * 1000;

  if (input.method === "PUT") {
    const contentType = LOCAL_OBJECT_CONTENT_TYPES.find((type) => type === contentTypeText);
    const maxBytes = positiveInteger(maxBytesText);
    if (!contentType || maxBytes === null) return REJECTED;
    return accepted({ contentType, expires, key, maxBytes, method: "PUT" })
      ? { contentType, maxBytes, method: "PUT", ok: true }
      : REJECTED;
  }

  if (contentTypeText !== null || maxBytesText !== null) return REJECTED;
  return accepted({ expires, key, method: "GET" }) ? { method: "GET", ok: true } : REJECTED;
}
