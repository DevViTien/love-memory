// Process gates that `openspec validate` does not cover.
//
// 1. Archive gate — a change whose tasks are all checked must be archived in the same PR. Until it
//    is, its delta specs sit in openspec/changes/ and openspec/specs/ silently omits behavior that
//    already shipped.
// 2. MODIFIED-body gate — a `## MODIFIED Requirements` block replaces the whole requirement on
//    archive, but OpenSpec only compares scenario names. A delta that forgets an error code or a
//    field name therefore archives green and deletes it from the truth. The gate compares the
//    backticked identifiers of each MODIFIED requirement against the current spec.
//
// Both gates accept time-boxed waivers from openspec/gate-exceptions.json; every waiver needs an
// owner, a reason and a YYYY-MM-DD expiry, and an expired or no-longer-matching waiver fails.

export type ChangeTasks = Readonly<{ name: string; tasksMarkdown: string | null }>;

export type PendingArchiveWaiver = Readonly<{
  blockedBy?: string;
  change: string;
  expires: string;
  owner: string;
  reason: string;
}>;

export type ModifiedBodyWaiver = Readonly<{
  capability: string;
  change: string;
  expires: string;
  owner: string;
  reason: string;
  requirement: string;
}>;

export type GateExceptions = Readonly<{
  modifiedBodyDrop: readonly ModifiedBodyWaiver[];
  pendingArchive: readonly PendingArchiveWaiver[];
}>;

export type DeltaSpec = Readonly<{
  capability: string;
  change: string;
  markdown: string;
}>;

export type GateResult = Readonly<{ errors: readonly string[]; warnings: readonly string[] }>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TASK_PATTERN = /^\s*[-*]\s+\[([ xX])\]/gm;
const KNOWN_DELTA_SECTIONS = new Set([
  "ADDED Requirements",
  "MODIFIED Requirements",
  "REMOVED Requirements",
  "RENAMED Requirements",
  "Purpose",
  "Requirements",
]);

export function countTasks(markdown: string): Readonly<{ done: number; total: number }> {
  let done = 0;
  let total = 0;
  for (const match of markdown.matchAll(TASK_PATTERN)) {
    total += 1;
    if (match[1] !== " ") done += 1;
  }
  return { done, total };
}

export function validateWaiverShape(
  waiver: Readonly<Record<string, unknown>>,
  label: string,
  requiredKeys: readonly string[],
): string[] {
  const errors: string[] = [];
  for (const key of [...requiredKeys, "owner", "reason", "expires"]) {
    if (typeof waiver[key] !== "string" || waiver[key] === "") {
      errors.push(`${label}: missing "${key}".`);
    }
  }
  const expires = waiver["expires"];
  if (typeof expires === "string" && expires !== "" && !DATE_PATTERN.test(expires)) {
    errors.push(`${label}: "expires" must be YYYY-MM-DD, got "${expires}".`);
  }
  return errors;
}

export function checkArchiveGate(
  changes: readonly ChangeTasks[],
  waivers: readonly PendingArchiveWaiver[],
  today: string,
): GateResult {
  const errors: string[] = [];
  const complete = new Set<string>();

  for (const change of changes) {
    if (change.tasksMarkdown === null) continue;
    const { done, total } = countTasks(change.tasksMarkdown);
    if (total > 0 && done === total) complete.add(change.name);
  }

  for (const name of complete) {
    const waiver = waivers.find((candidate) => candidate.change === name);
    if (!waiver) {
      errors.push(
        `change "${name}" has every task checked but is not archived. Archive it in this PR ` +
          `(pnpm openspec archive ${name} --yes), uncheck a task that is genuinely unfinished, ` +
          `or add a time-boxed pendingArchive waiver.`,
      );
    } else if (waiver.expires < today) {
      errors.push(`pendingArchive waiver for "${name}" expired on ${waiver.expires}.`);
    }
  }

  for (const waiver of waivers) {
    if (!complete.has(waiver.change)) {
      errors.push(`pendingArchive waiver for "${waiver.change}" no longer matches; remove it.`);
    }
  }

  return { errors, warnings: [] };
}

function splitSections(markdown: string): Map<string, string> {
  const parts = markdown.split(/^## (.+?)[ \t]*$/m);
  const sections = new Map<string, string>();
  for (let index = 1; index < parts.length; index += 2) {
    const name = (parts[index] ?? "").trim();
    sections.set(name, `${sections.get(name) ?? ""}\n${parts[index + 1] ?? ""}`);
  }
  return sections;
}

export function requirementsIn(markdown: string | undefined): Map<string, string> {
  const requirements = new Map<string, string>();
  if (!markdown) return requirements;
  const parts = markdown.split(/^### Requirement:[ \t]*(.+?)[ \t]*$/m);
  for (let index = 1; index < parts.length; index += 2) {
    requirements.set((parts[index] ?? "").trim(), parts[index + 1] ?? "");
  }
  return requirements;
}

function renamedFrom(markdown: string | undefined): Map<string, string> {
  const renames = new Map<string, string>();
  if (!markdown) return renames;
  const pattern =
    /^-\s*FROM:\s*`###\s*Requirement:\s*(.+?)`\s*$\s*^-\s*TO:\s*`###\s*Requirement:\s*(.+?)`\s*$/gm;
  for (const match of markdown.matchAll(pattern)) {
    renames.set((match[2] ?? "").trim(), (match[1] ?? "").trim());
  }
  return renames;
}

export function identifiers(markdown: string): Set<string> {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/`([^`\n]{2,80})`/g)) {
    if (match[1]) found.add(match[1]);
  }
  return found;
}

export function checkModifiedBodyGate(
  deltas: readonly DeltaSpec[],
  currentSpecs: ReadonlyMap<string, string>,
  waivers: readonly ModifiedBodyWaiver[],
  today: string,
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const usedWaivers = new Set<ModifiedBodyWaiver>();

  for (const delta of deltas) {
    const sections = splitSections(delta.markdown);
    for (const name of sections.keys()) {
      if (!KNOWN_DELTA_SECTIONS.has(name)) {
        errors.push(
          `${delta.change}/${delta.capability}: unknown section "## ${name}"; ` +
            `use the exact OpenSpec delta headers.`,
        );
      }
    }

    const modified = requirementsIn(sections.get("MODIFIED Requirements"));
    if (modified.size === 0) continue;
    const renames = renamedFrom(sections.get("RENAMED Requirements"));
    const current = requirementsIn(currentSpecs.get(delta.capability));

    for (const [name, body] of modified) {
      // Archive applies RENAMED before MODIFIED, so a renamed requirement still lives under its
      // old name in openspec/specs/.
      const currentName = current.has(name) ? name : renames.get(name);
      const currentBody = currentName === undefined ? undefined : current.get(currentName);
      if (currentBody === undefined) {
        warnings.push(
          `${delta.change}/${delta.capability}: MODIFIED "${name}" does not exist in ` +
            `openspec/specs/ and will fail on archive.`,
        );
        continue;
      }

      const kept = identifiers(body);
      const dropped = [...identifiers(currentBody)].filter((identifier) => !kept.has(identifier));
      if (dropped.length === 0) continue;

      const waiver = waivers.find(
        (candidate) =>
          candidate.change === delta.change &&
          candidate.capability === delta.capability &&
          candidate.requirement === name,
      );
      if (waiver) {
        usedWaivers.add(waiver);
        if (waiver.expires < today) {
          errors.push(
            `modifiedBodyDrop waiver for ${delta.change}/${delta.capability} "${name}" ` +
              `expired on ${waiver.expires}.`,
          );
        }
        continue;
      }

      errors.push(
        `${delta.change}/${delta.capability}: MODIFIED "${name}" drops ` +
          `${dropped.map((identifier) => `\`${identifier}\``).join(", ")}. Copy them back into ` +
          `the requirement, or add a modifiedBodyDrop waiver if the removal is intentional.`,
      );
    }
  }

  for (const waiver of waivers) {
    if (!usedWaivers.has(waiver)) {
      errors.push(
        `modifiedBodyDrop waiver for ${waiver.change}/${waiver.capability} ` +
          `"${waiver.requirement}" no longer matches; remove it.`,
      );
    }
  }

  return { errors, warnings };
}
