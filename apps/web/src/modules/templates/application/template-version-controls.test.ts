import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTemplateVersionControls,
  TemplateVersionActionRequestSchema,
  type TemplateVersionState,
  type TemplateVersionStateRepository,
} from "./template-version-controls";

const now = new Date("2026-10-10T08:00:00.000Z");

const killedState: TemplateVersionState = {
  current: true,
  killReason: "broken",
  killed: true,
  status: "retired",
  templateId: "memory-box",
  version: "1.1.0",
};

describe("template version action requests", () => {
  it("requires a reason for a kill and refuses one otherwise (Kill requires a reason)", () => {
    const kill = TemplateVersionActionRequestSchema.safeParse({
      action: "kill",
      templateId: "memory-box",
      version: "1.1.0",
    });
    expect(kill.success).toBe(false);
    expect(kill.error?.issues[0]?.path).toEqual(["reason"]);

    const retire = TemplateVersionActionRequestSchema.safeParse({
      action: "retire",
      reason: "broken",
      templateId: "memory-box",
      version: "1.1.0",
    });
    expect(retire.success).toBe(false);
    expect(retire.error?.issues[0]?.path).toEqual(["reason"]);

    expect(
      TemplateVersionActionRequestSchema.safeParse({
        action: "kill",
        reason: "security",
        templateId: "memory-box",
        version: "1.1.0",
      }).success,
    ).toBe(true);
    expect(
      TemplateVersionActionRequestSchema.safeParse({
        action: "kill",
        extra: true,
        reason: "security",
        templateId: "memory-box",
        version: "1.1.0",
      }).success,
    ).toBe(false);
  });
});

describe("template version controls", () => {
  const transition = vi.fn<TemplateVersionStateRepository["transition"]>();
  const findState = vi.fn<TemplateVersionStateRepository["findState"]>();
  const listVersions = vi.fn<TemplateVersionStateRepository["listVersions"]>();
  const controls = createTemplateVersionControls({
    clock: () => now,
    repository: { findState, isKilled: vi.fn(), listVersions, transition },
  });
  const actor = { id: "admin-1", requestId: "r-1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies a change and returns the new state", async () => {
    transition.mockResolvedValueOnce(true);
    findState.mockResolvedValueOnce(killedState);

    await expect(
      controls.apply(
        { action: "kill", reason: "broken", templateId: "memory-box", version: "1.1.0" },
        actor,
      ),
    ).resolves.toEqual({ changed: true, kind: "ok", version: killedState });
    expect(transition).toHaveBeenCalledWith({
      action: "kill",
      actorId: "admin-1",
      now,
      reason: "broken",
      requestId: "r-1",
      templateId: "memory-box",
      version: "1.1.0",
    });
  });

  it("reports a no-op as unchanged (Repeated kill changes nothing)", async () => {
    transition.mockResolvedValueOnce(false);
    findState.mockResolvedValueOnce(killedState);

    await expect(
      controls.apply(
        { action: "kill", reason: "broken", templateId: "memory-box", version: "1.1.0" },
        actor,
      ),
    ).resolves.toEqual({ changed: false, kind: "ok", version: killedState });
  });

  it("answers not-found for an unknown version and not-released for a draft (Unknown version)", async () => {
    transition.mockResolvedValue(false);
    findState.mockResolvedValueOnce(null);
    await expect(
      controls.apply({ action: "retire", templateId: "memory-box", version: "9.9.9" }, actor),
    ).resolves.toEqual({ kind: "not-found" });

    findState.mockResolvedValueOnce({ ...killedState, killed: false, status: "draft" });
    await expect(
      controls.apply({ action: "retire", templateId: "memory-box", version: "2.0.0" }, actor),
    ).resolves.toEqual({ kind: "not-released" });
  });

  it("lists the stored versions", async () => {
    listVersions.mockResolvedValueOnce([killedState]);

    await expect(controls.listVersions()).resolves.toEqual([killedState]);
  });
});
