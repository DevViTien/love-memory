import { describe, expect, it } from "vitest";

import {
  findStepOfField,
  resolveStudioLocation,
  resolveStudioSteps,
  stepSearch,
  studioFieldHref,
  studioFieldInputId,
  studioStepHeadingId,
} from "./studio-steps";
import { flatManifest, steppedManifest } from "./test/fixtures";

describe("resolveStudioSteps", () => {
  it("keeps declared template steps in order and appends the Studio steps", () => {
    const steps = resolveStudioSteps(steppedManifest);

    expect(steps.map((step) => step.label)).toEqual([
      "Người nhận",
      "Lời mở hộp",
      "Kỷ niệm",
      "Lá thư",
      "Giao diện & nhạc",
      "Xem trước",
      "Xuất bản",
    ]);
    expect(steps.map((step) => step.kind)).toEqual([
      "template",
      "template",
      "template",
      "template",
      "template",
      "preview",
      "publish",
    ]);
    expect(steps[0]?.fieldIds).toEqual(["receiver-name", "anniversary-date"]);
  });

  it("uses the default content step for a manifest without steps", () => {
    const steps = resolveStudioSteps(flatManifest);

    expect(steps.map((step) => step.id)).toEqual(["content", "preview", "publish"]);
    expect(steps[0]).toMatchObject({
      fieldIds: ["headline", "photos", "final-message"],
      label: "Nội dung",
    });
  });
});

describe("resolveStudioLocation", () => {
  const steps = resolveStudioSteps(steppedManifest);

  it.each([
    [{ field: "final-letter" }, { focusFieldId: "final-letter", stepId: "letter" }],
    [
      { field: "memories", step: "recipient" },
      { focusFieldId: "memories", stepId: "memories" },
    ],
    [{ step: "style" }, { focusFieldId: null, stepId: "style" }],
    [{ step: "publish" }, { focusFieldId: null, stepId: "publish" }],
    [{ field: "not-a-field" }, { focusFieldId: null, stepId: "recipient" }],
    [{ step: "not-a-step" }, { focusFieldId: null, stepId: "recipient" }],
    [
      { field: "not-a-field", step: "letter" },
      { focusFieldId: null, stepId: "letter" },
    ],
    [{}, { focusFieldId: null, stepId: "recipient" }],
    [
      { field: null, step: null },
      { focusFieldId: null, stepId: "recipient" },
    ],
  ])("resolves %j", (query, expected) => {
    expect(resolveStudioLocation(steps, steppedManifest, query)).toEqual(expected);
  });

  it("falls back to an empty id when there is no step at all", () => {
    expect(resolveStudioLocation([], steppedManifest, { field: "final-letter" })).toEqual({
      focusFieldId: null,
      stepId: "",
    });
  });
});

describe("URL helpers", () => {
  it("builds step searches, field links and element ids", () => {
    const steps = resolveStudioSteps(steppedManifest);

    expect(stepSearch("letter")).toBe("?step=letter");
    expect(studioFieldHref("q1w2e3r4t5y6u7i8", "audio")).toBe(
      "/studio/q1w2e3r4t5y6u7i8?field=audio",
    );
    expect(studioFieldInputId("memories")).toBe("studio-field-memories");
    expect(studioStepHeadingId("letter")).toBe("studio-step-letter");
    expect(findStepOfField(steps, "audio")?.id).toBe("style");
    expect(findStepOfField(steps, "unknown")).toBeUndefined();
  });
});
