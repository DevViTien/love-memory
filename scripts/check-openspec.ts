import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ChangeTasks,
  checkArchiveGate,
  checkModifiedBodyGate,
  type DeltaSpec,
  type GateExceptions,
  type ModifiedBodyWaiver,
  type PendingArchiveWaiver,
  validateWaiverShape,
} from "./openspec-gates";

const OPENSPEC_ROOT = "openspec";
const CHANGES_ROOT = join(OPENSPEC_ROOT, "changes");
const SPECS_ROOT = join(OPENSPEC_ROOT, "specs");
const EXCEPTIONS_PATH = join(OPENSPEC_ROOT, "gate-exceptions.json");

function directories(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function loadExceptions(errors: string[]): GateExceptions {
  const raw = readIfExists(EXCEPTIONS_PATH);
  if (raw === null) return { modifiedBodyDrop: [], pendingArchive: [] };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    errors.push(`${EXCEPTIONS_PATH}: invalid JSON (${String(error)}).`);
    return { modifiedBodyDrop: [], pendingArchive: [] };
  }

  function section<T>(key: string, requiredKeys: readonly string[]): T[] {
    const value = parsed[key] ?? [];
    if (!Array.isArray(value)) {
      errors.push(`${EXCEPTIONS_PATH}: "${key}" must be an array.`);
      return [];
    }
    value.forEach((waiver: Record<string, unknown>, index) => {
      errors.push(
        ...validateWaiverShape(waiver, `${EXCEPTIONS_PATH} ${key}[${index}]`, requiredKeys),
      );
    });
    return value as T[];
  }

  return {
    modifiedBodyDrop: section<ModifiedBodyWaiver>("modifiedBodyDrop", [
      "change",
      "capability",
      "requirement",
    ]),
    pendingArchive: section<PendingArchiveWaiver>("pendingArchive", ["change"]),
  };
}

const activeChanges = directories(CHANGES_ROOT).filter((name) => name !== "archive");
const changes: ChangeTasks[] = activeChanges.map((name) => ({
  name,
  tasksMarkdown: readIfExists(join(CHANGES_ROOT, name, "tasks.md")),
}));
const deltas: DeltaSpec[] = activeChanges.flatMap((change) =>
  directories(join(CHANGES_ROOT, change, "specs")).flatMap((capability) => {
    const markdown = readIfExists(join(CHANGES_ROOT, change, "specs", capability, "spec.md"));
    return markdown === null ? [] : [{ capability, change, markdown }];
  }),
);
const currentSpecs = new Map(
  directories(SPECS_ROOT).flatMap((capability) => {
    const markdown = readIfExists(join(SPECS_ROOT, capability, "spec.md"));
    return markdown === null ? [] : [[capability, markdown] as const];
  }),
);

const shapeErrors: string[] = [];
const exceptions = loadExceptions(shapeErrors);
// UTC keeps developer machines and CI on the same date.
const today = new Date().toISOString().slice(0, 10);
const archive = checkArchiveGate(changes, exceptions.pendingArchive, today);
const modifiedBody = checkModifiedBodyGate(
  deltas,
  currentSpecs,
  exceptions.modifiedBodyDrop,
  today,
);

const errors = [...shapeErrors, ...archive.errors, ...modifiedBody.errors];
for (const warning of modifiedBody.warnings) console.warn(`openspec gate warning: ${warning}`);

if (errors.length > 0) {
  console.error(`OpenSpec gates failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `OpenSpec gates passed: ${currentSpecs.size} specs, ${activeChanges.length} active changes, ` +
      `${deltas.length} delta specs.\n`,
  );
}
