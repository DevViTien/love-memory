import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminAccess, type AdminSession } from "@/modules/admin/application/admin-access";

import {
  type TemplateVersionControls,
  type TemplateVersionState,
} from "../application/template-version-controls";
import {
  handleTemplateVersionAction,
  type TemplateVersionRouteDependencies,
} from "./template-version-route-handler";

const session: AdminSession = {
  sessionId: "session-1",
  user: { email: "admin@example.test", id: "admin-1", role: "admin", twoFactorEnabled: true },
};

const killed: TemplateVersionState = {
  current: true,
  killReason: "broken",
  killed: true,
  status: "retired",
  templateId: "memory-box",
  version: "1.1.0",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/admin/template-versions", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-request-id": "request-1",
      ...headers,
    },
    method: "POST",
  });
}

describe("POST /api/admin/template-versions", () => {
  const getAccess = vi.fn<(headers: Headers) => Promise<AdminAccess>>();
  const apply = vi.fn<TemplateVersionControls["apply"]>();
  const limit = vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }));
  const dependencies: TemplateVersionRouteDependencies = { controls: { apply }, getAccess, limit };
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    getAccess.mockResolvedValue({ kind: "admin", session });
  });

  it("kills a version with a reason and returns its state", async () => {
    apply.mockResolvedValueOnce({ changed: true, kind: "ok", version: killed });

    const response = await handleTemplateVersionAction(
      post({ action: "kill", reason: "broken", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        changed: true,
        killReason: "broken",
        killed: true,
        status: "retired",
        templateId: "memory-box",
        version: "1.1.0",
      },
    });
    expect(apply).toHaveBeenCalledWith(
      { action: "kill", reason: "broken", templateId: "memory-box", version: "1.1.0" },
      { id: "admin-1", requestId: "request-1" },
    );
  });

  it("answers a no-op with changed false (Repeated kill changes nothing)", async () => {
    apply.mockResolvedValueOnce({ changed: false, kind: "ok", version: killed });

    const response = await handleTemplateVersionAction(
      post({ action: "kill", reason: "broken", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );

    await expect(response.json()).resolves.toMatchObject({ data: { changed: false } });
  });

  it("refuses a kill without a reason and a retire with one (Kill requires a reason)", async () => {
    const kill = await handleTemplateVersionAction(
      post({ action: "kill", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );
    expect(kill.status).toBe(400);
    await expect(kill.json()).resolves.toMatchObject({
      error: { fieldErrors: { reason: expect.any(String) as string } },
    });

    const retire = await handleTemplateVersionAction(
      post({ action: "retire", reason: "legal", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );
    expect(retire.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown version and 409 for a draft (Unknown version)", async () => {
    apply.mockResolvedValueOnce({ kind: "not-found" });
    const unknown = await handleTemplateVersionAction(
      post({ action: "retire", templateId: "memory-box", version: "9.9.9" }),
      dependencies,
    );
    expect(unknown.status).toBe(404);

    apply.mockResolvedValueOnce({ kind: "not-released" });
    const draft = await handleTemplateVersionAction(
      post({ action: "retire", templateId: "memory-box", version: "2.0.0" }),
      dependencies,
    );
    expect(draft.status).toBe(409);
    await expect(draft.json()).resolves.toMatchObject({
      error: { code: "CONFLICT", details: { reason: "VERSION_NOT_RELEASED" } },
    });
  });

  it("answers 404 to non-admins and 403 MFA_REQUIRED without a step-up (Not an admin)", async () => {
    getAccess.mockResolvedValueOnce({ kind: "none" });
    const creator = await handleTemplateVersionAction(
      post({ action: "retire", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );
    expect(creator.status).toBe(404);

    getAccess.mockResolvedValueOnce({ kind: "needs-step-up", session });
    const noStepUp = await handleTemplateVersionAction(
      post({ action: "retire", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );
    expect(noStepUp.status).toBe(403);
    await expect(noStepUp.json()).resolves.toMatchObject({
      error: { details: { reason: "MFA_REQUIRED" } },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 429 when the admin-action budget is spent, before any change", async () => {
    limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });

    const response = await handleTemplateVersionAction(
      post({ action: "retire", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );

    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith("admin-1");
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuses a foreign origin, and answers 500 when the change fails", async () => {
    const foreign = await handleTemplateVersionAction(
      post(
        { action: "retire", templateId: "memory-box", version: "1.1.0" },
        { origin: "https://evil.example" },
      ),
      dependencies,
    );
    expect(foreign.status).toBe(403);

    apply.mockRejectedValueOnce(new Error("audit down"));
    const failed = await handleTemplateVersionAction(
      post({ action: "retire", templateId: "memory-box", version: "1.1.0" }),
      dependencies,
    );
    expect(failed.status).toBe(500);
  });
});
