import type * as FsModule from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fsSpies = vi.hoisted(() => ({ existsSync: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  fsSpies.existsSync.mockImplementation(actual.existsSync);
  return { ...actual, existsSync: fsSpies.existsSync };
});

import {
  findWorkspaceRoot,
  getStorageConfiguration,
  parseStorageConfiguration,
  parseStorageEnvironment,
} from "./environment";
import { getLocalObjectStorageOrigin, StorageConfigurationError } from "./local-object-origin";

const secret = "s".repeat(32);
const workspaceRoot = join(tmpdir(), "love-memory-workspace");
const localSource = {
  APP_URL: "http://127.0.0.1:3100/studio",
  LOCAL_OBJECT_STORAGE_SECRET: secret,
  STORAGE_DRIVER: "local",
};

describe("storage environment", () => {
  it("uses Vercel OIDC credentials when available", () => {
    expect(
      parseStorageEnvironment({
        BLOB_READ_WRITE_TOKEN: "legacy-token",
        BLOB_STORE_ID: "store_abc123",
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
    ).toEqual({ storeId: "store_abc123" });
  });

  it("allows the Blob SDK to resolve runtime OIDC from Vercel request context", () => {
    expect(parseStorageEnvironment({ BLOB_STORE_ID: "store_abc123" })).toEqual({
      storeId: "store_abc123",
    });
  });

  it("supports the read-write token required for local development", () => {
    expect(parseStorageEnvironment({ BLOB_READ_WRITE_TOKEN: "local-token" })).toEqual({
      token: "local-token",
    });
  });

  it("prefers a static token outside Vercel when a store id was also synchronized", () => {
    expect(
      parseStorageEnvironment({
        BLOB_READ_WRITE_TOKEN: "worker-token",
        BLOB_STORE_ID: "store_abc123",
      }),
    ).toEqual({ token: "worker-token" });
  });

  it("rejects missing or incomplete credentials", () => {
    expect(() => parseStorageEnvironment({})).toThrow();
    expect(() => parseStorageEnvironment({ VERCEL_OIDC_TOKEN: "oidc-token" })).toThrow();
  });
});

describe("storage configuration", () => {
  const parse = (source: Record<string, string | undefined>) =>
    parseStorageConfiguration(source, { workspaceRoot });

  it("defaults to the Vercel Blob driver with its credential rules (Default driver)", () => {
    for (const driver of [undefined, ""]) {
      expect(parse({ BLOB_READ_WRITE_TOKEN: "token", STORAGE_DRIVER: driver })).toEqual({
        credentials: { token: "token" },
        driver: "vercel-blob",
      });
    }
    expect(parse({ BLOB_STORE_ID: "store", STORAGE_DRIVER: "vercel-blob" })).toEqual({
      credentials: { storeId: "store" },
      driver: "vercel-blob",
    });
    expect(() => parse({})).toThrow(StorageConfigurationError);
  });

  it("never resolves the workspace root for the Blob driver", () => {
    const resolveRoot = vi.fn(() => workspaceRoot);
    parseStorageConfiguration({ BLOB_READ_WRITE_TOKEN: "token" }, { workspaceRoot: resolveRoot });
    expect(resolveRoot).not.toHaveBeenCalled();
  });

  it("rejects an unknown driver (Unknown driver rejected)", () => {
    for (const driver of ["s3", "LOCAL", " local"]) {
      expect(() => parse({ ...localSource, STORAGE_DRIVER: driver })).toThrow(
        StorageConfigurationError,
      );
    }
  });

  it("uses the APP_URL origin and the workspace directory for the local driver", () => {
    expect(parse(localSource)).toEqual({
      driver: "local",
      publicOrigin: "http://127.0.0.1:3100",
      rootDirectory: join(workspaceRoot, ".tmp", "object-storage"),
      signingSecret: secret,
    });
    expect(parse({ ...localSource, VERCEL_ENV: "" }).driver).toBe("local");
    expect(parse({ ...localSource, VERCEL_ENV: "development" }).driver).toBe("local");
  });

  it("requires a usable secret (Local driver without a usable secret)", () => {
    for (const value of [undefined, "", "s".repeat(31), "s".repeat(257)]) {
      expect(() => parse({ ...localSource, LOCAL_OBJECT_STORAGE_SECRET: value })).toThrow(
        StorageConfigurationError,
      );
    }
    expect(parse({ ...localSource, LOCAL_OBJECT_STORAGE_SECRET: "s".repeat(256) }).driver).toBe(
      "local",
    );
  });

  it("requires an HTTP(S) application URL (Local driver without an application URL)", () => {
    for (const value of [undefined, "", "/relative", "ftp://example.test", "not a url"]) {
      expect(() => parse({ ...localSource, APP_URL: value })).toThrow(StorageConfigurationError);
    }
  });

  it("refuses local storage on Vercel deployments without echoing values", () => {
    for (const vercelEnvironment of ["production", "preview", "staging-custom", "Development"]) {
      let thrown: unknown;
      try {
        parse({ ...localSource, VERCEL_ENV: vercelEnvironment });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StorageConfigurationError);
      expect((thrown as Error).message).not.toContain(secret);
    }
  });

  it("allows a local production build (Local production build allowed)", () => {
    expect(parse({ ...localSource, NODE_ENV: "production" }).driver).toBe("local");
  });
});

describe("workspace root", () => {
  const base = mkdtempSync(join(tmpdir(), "lm-root-"));
  const root = join(base, "repo");
  const nested = join(root, "apps", "web");
  const outside = join(base, "outside");
  mkdirSync(nested, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");

  afterAll(() => rmSync(base, { force: true, recursive: true }));

  it("finds the nearest ancestor with pnpm-workspace.yaml", () => {
    expect(findWorkspaceRoot(nested)).toBe(root);
    expect(findWorkspaceRoot(root)).toBe(root);
  });

  it("fails when no workspace is found", () => {
    expect(() => findWorkspaceRoot(outside)).toThrow(StorageConfigurationError);
  });

  it("resolves the local directory from the current working directory", () => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("LOCAL_OBJECT_STORAGE_SECRET", secret);
    vi.stubEnv("VERCEL_ENV", "");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(nested);
    try {
      expect(getStorageConfiguration()).toMatchObject({
        driver: "local",
        rootDirectory: join(root, ".tmp", "object-storage"),
      });
    } finally {
      cwd.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe("local storage origin", () => {
  beforeEach(() => fsSpies.existsSync.mockClear());

  it("returns the APP_URL origin for an allowed local configuration", () => {
    expect(getLocalObjectStorageOrigin(localSource)).toBe("http://127.0.0.1:3100");
    expect(getLocalObjectStorageOrigin({ ...localSource, VERCEL_ENV: "development" })).toBe(
      "http://127.0.0.1:3100",
    );
  });

  it("returns nothing for refused, misconfigured or Blob configurations", () => {
    for (const source of [
      { ...localSource, VERCEL_ENV: "production" },
      { ...localSource, VERCEL_ENV: "preview" },
      { ...localSource, LOCAL_OBJECT_STORAGE_SECRET: "short" },
      { ...localSource, APP_URL: "javascript:alert(1)" },
      { ...localSource, STORAGE_DRIVER: "s3" },
      { ...localSource, STORAGE_DRIVER: undefined },
      { BLOB_READ_WRITE_TOKEN: "token", STORAGE_DRIVER: "vercel-blob" },
      {},
    ]) {
      expect(getLocalObjectStorageOrigin(source)).toBeUndefined();
    }
  });

  it("never touches the filesystem", () => {
    getLocalObjectStorageOrigin(localSource);
    getLocalObjectStorageOrigin({ ...localSource, VERCEL_ENV: "preview" });
    expect(fsSpies.existsSync).not.toHaveBeenCalled();
    findWorkspaceRoot(process.cwd());
    expect(fsSpies.existsSync).toHaveBeenCalled();
  });
});
