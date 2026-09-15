import { z } from "zod";

import { type TemplateManifest } from "./manifest";

export const TemplateBuildMetricsSchema = z
  .object({
    initialJsKbGzip: z.number().nonnegative(),
    initialMediaKb: z.number().nonnegative(),
    maxTextureMb: z.number().nonnegative(),
  })
  .strict();

export type TemplateBuildMetrics = z.infer<typeof TemplateBuildMetricsSchema>;
export type TemplateBudgetMetric = keyof TemplateBuildMetrics;
export type TemplateBudgetViolation = Readonly<{
  actual: number;
  limit: number;
  metric: TemplateBudgetMetric;
}>;

export function findTemplateBudgetViolations(
  manifest: TemplateManifest,
  input: unknown,
): readonly TemplateBudgetViolation[] {
  const metrics = TemplateBuildMetricsSchema.parse(input);
  const metricNames = Object.keys(metrics) as TemplateBudgetMetric[];

  return metricNames.flatMap((metric) => {
    const actual = metrics[metric];
    const limit = manifest.budgets[metric];

    return actual > limit ? [{ actual, limit, metric }] : [];
  });
}

export function assertTemplateBuildWithinBudget(
  manifest: TemplateManifest,
  input: unknown,
): TemplateBuildMetrics {
  const metrics = TemplateBuildMetricsSchema.parse(input);
  const violations = findTemplateBudgetViolations(manifest, metrics);

  if (violations.length > 0) {
    const summary = violations
      .map(({ actual, limit, metric }) => `${metric}: ${actual} > ${limit}`)
      .join(", ");

    throw new Error(`Template build exceeds its budget (${summary}).`);
  }

  return metrics;
}
