// @vitest-environment node
import type * as DatabaseModule from "@love-memory/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ pingDatabase: vi.fn() }));
const mediaMocks = vi.hoisted(() => ({ checkMediaOutbox: vi.fn() }));

vi.mock("@/composition/media", () => ({ checkMediaOutbox: mediaMocks.checkMediaOutbox }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  pingDatabase: databaseMocks.pingDatabase,
}));

import { MediaOutboxStalledError } from "@/modules/media/application/media-outbox-health";

import { GET } from "./route";

function stubLocalStorage(vercelEnvironment = "") {
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
  vi.stubEnv("LOCAL_OBJECT_STORAGE_SECRET", "readiness-local-object-storage-secret");
  vi.stubEnv("VERCEL_ENV", vercelEnvironment);
}

describe("readiness dependency checks", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    databaseMocks.pingDatabase.mockResolvedValue(undefined);
    mediaMocks.checkMediaOutbox.mockResolvedValue(undefined);
    for (const name of [
      "BLOB_READ_WRITE_TOKEN",
      "BLOB_STORE_ID",
      "VERCEL_OIDC_TOKEN",
      "STORAGE_DRIVER",
      "TRIGGER_SECRET_KEY",
      "VERCEL_ENV",
    ]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("MEDIA_WORKER_MODE", "inline");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is ready with Blob credentials, an inline worker and a reachable database", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ok");
  });

  it("is unavailable when the Blob driver has no credentials (Missing storage configuration)", async () => {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(databaseMocks.pingDatabase).not.toHaveBeenCalled();
  });

  it("is ready with local storage and no Blob credentials (Local storage without Blob credentials)", async () => {
    stubLocalStorage();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(databaseMocks.pingDatabase).toHaveBeenCalledOnce();
  });

  it("refuses local storage on a Vercel deployment", async () => {
    for (const vercelEnvironment of ["production", "preview"]) {
      stubLocalStorage(vercelEnvironment);
      const response = await GET();
      expect(response.status).toBe(503);
    }
  });

  it("refuses local storage with Trigger.dev workers", async () => {
    stubLocalStorage();
    vi.stubEnv("MEDIA_WORKER_MODE", "trigger");
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_example");
    const response = await GET();
    expect(response.status).toBe(503);
  });

  it("is unavailable when MongoDB does not answer", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    databaseMocks.pingDatabase.mockRejectedValue(new Error("unreachable"));
    const response = await GET();
    expect(response.status).toBe(503);
  });

  it("is unavailable with a generic body when a media job is overdue (Media worker stalled)", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    mediaMocks.checkMediaOutbox.mockRejectedValue(new MediaOutboxStalledError());
    const errorLog = vi.mocked(console.error);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { error: Record<string, string> };
    expect(body.error).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Service dependencies are not ready.",
      requestId: response.headers.get("x-request-id"),
    });
    expect(errorLog).toHaveBeenCalledWith("Readiness check failed", {
      errorName: "MediaOutboxStalledError",
      requestId: response.headers.get("x-request-id"),
    });
  });

  it("checks the media outbox only after MongoDB answers", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    databaseMocks.pingDatabase.mockRejectedValue(new Error("unreachable"));

    expect((await GET()).status).toBe(503);
    expect(mediaMocks.checkMediaOutbox).not.toHaveBeenCalled();
  });
});
