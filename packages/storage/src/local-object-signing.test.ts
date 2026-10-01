import { describe, expect, it } from "vitest";

import { signLocalObjectUrl, verifyLocalObjectRequest } from "./local-object-signing";

const secret = "local-object-storage-test-secret-0001";
const key = "private/assets/0f8fad5b-d9cb-469f-a165-70867728950e/source";
const issuedAt = new Date("2026-10-01T00:00:00.000Z");
const expiresAt = new Date(issuedAt.getTime() + 300_000);

function signGet(overrides: Partial<{ key: string; secret: string }> = {}) {
  return new URL(
    signLocalObjectUrl({
      expiresAt,
      key: overrides.key ?? key,
      method: "GET",
      publicOrigin: "http://127.0.0.1:3100",
      secret: overrides.secret ?? secret,
    }),
  );
}

function signPut() {
  return new URL(
    signLocalObjectUrl({
      contentType: "image/jpeg",
      expiresAt,
      key,
      maxBytes: 4096,
      method: "PUT",
      publicOrigin: "http://127.0.0.1:3100",
      secret,
    }),
  );
}

function verify(
  url: URL,
  options: Partial<{ key: string; method: string; now: Date; secret: string }> = {},
) {
  return verifyLocalObjectRequest({
    key: options.key ?? key,
    method: options.method ?? "GET",
    now: options.now ?? issuedAt,
    parameters: url.searchParams,
    secret: options.secret ?? secret,
  });
}

function withParameter(url: URL, name: string, value: string | null): URL {
  const copy = new URL(url);
  if (value === null) copy.searchParams.delete(name);
  else copy.searchParams.set(name, value);
  return copy;
}

describe("signed local object URLs", () => {
  it("issues an APP_URL-origin URL with an encoded key and expiring signature", () => {
    const url = signGet();
    expect(url.origin).toBe("http://127.0.0.1:3100");
    expect(url.pathname).toBe(`/api/local-object-storage/${key}`);
    expect(url.searchParams.get("expires")).toBe(String(expiresAt.getTime() / 1000));
    expect(url.searchParams.get("signature")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.has("contentType")).toBe(false);
    expect(verify(url)).toEqual({ method: "GET", ok: true });
  });

  it("binds the content type and size of an upload URL", () => {
    const url = signPut();
    expect(url.searchParams.get("contentType")).toBe("image/jpeg");
    expect(url.searchParams.get("maxBytes")).toBe("4096");
    expect(verify(url, { method: "PUT" })).toEqual({
      contentType: "image/jpeg",
      maxBytes: 4096,
      method: "PUT",
      ok: true,
    });
    expect(verify(withParameter(url, "maxBytes", "4097"), { method: "PUT" }).ok).toBe(false);
    expect(verify(withParameter(url, "contentType", "image/png"), { method: "PUT" }).ok).toBe(
      false,
    );
  });

  it("refuses to sign an invalid key", () => {
    expect(() => signGet({ key: "../secret" })).toThrow();
  });

  it("rejects a tampered signature or a changed key", () => {
    const url = signGet();
    const signature = url.searchParams.get("signature")!;
    const tampered = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(verify(withParameter(url, "signature", tampered)).ok).toBe(false);
    expect(verify(url, { key: key.replace("source", "other") }).ok).toBe(false);
    expect(verify(url, { key: "../source" }).ok).toBe(false);
  });

  it("rejects an expired URL and a URL used exactly at its expiry", () => {
    const url = signGet();
    expect(verify(url, { now: new Date(expiresAt.getTime() - 1) }).ok).toBe(true);
    expect(verify(url, { now: expiresAt }).ok).toBe(false);
    expect(verify(url, { now: new Date(expiresAt.getTime() + 1000) }).ok).toBe(false);
  });

  it("binds the HTTP method", () => {
    expect(verify(signGet(), { method: "PUT" }).ok).toBe(false);
    expect(verify(signPut(), { method: "GET" }).ok).toBe(false);
    expect(verify(signGet(), { method: "HEAD" }).ok).toBe(false);
    expect(verify(signGet(), { method: "DELETE" }).ok).toBe(false);
  });

  it("rejects a URL signed with a different secret", () => {
    expect(verify(signGet({ secret: "another-local-object-storage-secret" })).ok).toBe(false);
  });

  it("rejects missing, malformed or duplicated parameters", () => {
    const url = signGet();
    for (const [name, value] of [
      ["expires", null],
      ["expires", "soon"],
      ["expires", "0"],
      ["expires", "-1"],
      ["expires", "1e10"],
      ["expires", "99999999999999999"],
      ["signature", null],
      ["signature", ""],
      ["signature", "not base64url!"],
      ["signature", `${url.searchParams.get("signature")}A`],
      ["signature", "A".repeat(44)],
      ["contentType", "image/jpeg"],
      ["maxBytes", "10"],
    ] as const) {
      expect(verify(withParameter(url, name, value)).ok).toBe(false);
    }
    const duplicated = new URL(url);
    duplicated.searchParams.append("expires", url.searchParams.get("expires")!);
    expect(verify(duplicated).ok).toBe(false);

    const upload = signPut();
    for (const [name, value] of [
      ["contentType", null],
      ["contentType", "text/html"],
      ["maxBytes", null],
      ["maxBytes", "0"],
      ["maxBytes", "12.5"],
    ] as const) {
      expect(verify(withParameter(upload, name, value), { method: "PUT" }).ok).toBe(false);
    }
  });

  it("rejects a non-canonical base64url signature with the same bytes", () => {
    const url = signGet();
    const signature = url.searchParams.get("signature")!;
    const last = signature.at(-1)!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // The last character carries two unused bits; flipping them keeps the decoded bytes.
    const sibling = alphabet[alphabet.indexOf(last) ^ 1]!;
    expect(Buffer.from(signature.slice(0, -1) + sibling, "base64url")).toEqual(
      Buffer.from(signature, "base64url"),
    );
    expect(verify(withParameter(url, "signature", signature.slice(0, -1) + sibling)).ok).toBe(
      false,
    );
  });
});
