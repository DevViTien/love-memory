import { resolveTemplateSteps, type TemplateManifest } from "@love-memory/template-sdk";

export type StudioStepKind = "preview" | "publish" | "template";

export type StudioStep = Readonly<{
  fieldIds: readonly string[];
  id: string;
  kind: StudioStepKind;
  label: string;
}>;

export type StudioLocation = Readonly<{ focusFieldId: string | null; stepId: string }>;

export type StudioLocationQuery = Readonly<{
  field?: string | null | undefined;
  step?: string | null | undefined;
}>;

/** Studio-level steps that follow the template steps; the SDK reserves these ids. */
const studioSteps: readonly StudioStep[] = [
  { fieldIds: [], id: "preview", kind: "preview", label: "Xem trước" },
  { fieldIds: [], id: "publish", kind: "publish", label: "Xuất bản" },
];

/** The template steps of the manifest in declared order, then `Xem trước` and `Xuất bản`. */
export function resolveStudioSteps(manifest: TemplateManifest): readonly StudioStep[] {
  return [
    ...resolveTemplateSteps(manifest).map((step): StudioStep => ({
      fieldIds: step.fieldIds,
      id: step.id,
      kind: "template",
      label: step.label,
    })),
    ...studioSteps,
  ];
}

/**
 * Resolves the page location: a known `field` wins over `step`, a known `step` comes next, and
 * anything else opens the first step.
 */
export function resolveStudioLocation(
  steps: readonly StudioStep[],
  manifest: TemplateManifest,
  query: StudioLocationQuery,
): StudioLocation {
  const firstStepId = steps[0]?.id ?? "";
  const field = query.field ?? null;
  if (field !== null && manifest.fields.some((candidate) => candidate.id === field)) {
    const owner = steps.find((step) => step.fieldIds.includes(field));
    if (owner) return { focusFieldId: field, stepId: owner.id };
  }

  const step = query.step ?? null;
  if (step !== null && steps.some((candidate) => candidate.id === step)) {
    return { focusFieldId: null, stepId: step };
  }

  return { focusFieldId: null, stepId: firstStepId };
}

export function stepSearch(stepId: string): string {
  return `?${new URLSearchParams({ step: stepId }).toString()}`;
}

export function studioFieldHref(publicId: string, fieldId: string): string {
  return `/studio/${publicId}?${new URLSearchParams({ field: fieldId }).toString()}`;
}

/** The id of a field's primary control, used by deep links and `Sửa` links. */
export function studioFieldInputId(fieldId: string): string {
  return `studio-field-${fieldId}`;
}

export function studioStepHeadingId(stepId: string): string {
  return `studio-step-${stepId}`;
}

export function findStepOfField(
  steps: readonly StudioStep[],
  fieldId: string,
): StudioStep | undefined {
  return steps.find((step) => step.fieldIds.includes(fieldId));
}
