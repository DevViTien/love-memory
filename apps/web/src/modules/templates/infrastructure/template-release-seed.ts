import { parseTemplateManifest, parseTemplatePayload } from "@love-memory/template-sdk";
import { createHash } from "node:crypto";

export type TemplateVersionStatus = "published" | "retired";

export type SeedTemplateVersion = Readonly<{
  /** The manifest as authored (never the parser output). */
  manifest: Readonly<Record<string, unknown>>;
  previewFixture: Readonly<Record<string, unknown>>;
  status: TemplateVersionStatus;
}>;

export type SeedTemplateRelease = Readonly<{
  currentVersion: string;
  templateId: string;
  /** Array position of the release is the template `sortOrder`. */
  versions: readonly SeedTemplateVersion[];
}>;

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, array order kept. Used to compare
 * and hash manifests independently of key order or SDK defaults.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function manifestContentHash(manifest: unknown): string {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

/** The collection methods the seed uses, so tests can pass a fake collection. */
export type SeedCollection = Readonly<{
  findOne: (filter: Readonly<{ _id: string }>) => Promise<Readonly<{ manifest?: unknown }> | null>;
  updateOne: (
    filter: Readonly<{ _id: string }>,
    update: Readonly<Record<string, unknown>>,
    options: Readonly<{ upsert: boolean }>,
  ) => Promise<unknown>;
}>;

export type TemplateSeedCollections = Readonly<{
  templates: SeedCollection;
  templateVersions: SeedCollection;
}>;

function versionOf(version: SeedTemplateVersion): string {
  return parseTemplateManifest(version.manifest).version;
}

/**
 * Throws when `<templateId>@<version>` is already stored with a manifest whose content differs from
 * the seed's: a template release is immutable.
 */
export async function assertTemplateVersionUnchanged(
  collection: SeedCollection,
  templateId: string,
  version: SeedTemplateVersion,
): Promise<void> {
  const manifest = parseTemplateManifest(version.manifest);
  parseTemplatePayload(manifest, version.previewFixture);
  const id = `${templateId}@${manifest.version}`;
  const stored = await collection.findOne({ _id: id });
  if (stored && canonicalJson(stored.manifest) !== canonicalJson(version.manifest)) {
    throw new Error(`Template release ${id} is immutable and differs from the seed`);
  }
}

/**
 * Upserts one template version. A new document stores the raw manifest, its preview fixture and
 * `sha256(canonicalJson(manifest))`; an existing document keeps them and only gets its `status`.
 */
export async function upsertTemplateVersion(
  collection: SeedCollection,
  templateId: string,
  version: SeedTemplateVersion,
  now: Date,
): Promise<void> {
  await assertTemplateVersionUnchanged(collection, templateId, version);
  const versionId = versionOf(version);
  await collection.updateOne(
    { _id: `${templateId}@${versionId}` },
    {
      $set: { status: version.status, updatedAt: now },
      $setOnInsert: {
        contentHash: manifestContentHash(version.manifest),
        createdAt: now,
        manifest: version.manifest,
        previewFixture: version.previewFixture,
        templateId,
        version: versionId,
      },
    },
    { upsert: true },
  );
}

/**
 * Seeds one template: checks every version before writing anything for it, then upserts the
 * versions and the `templates` document with its current version and `sortOrder`.
 */
export async function seedTemplateRelease(
  collections: TemplateSeedCollections,
  release: SeedTemplateRelease,
  sortOrder: number,
  now: Date,
): Promise<void> {
  for (const version of release.versions) {
    await assertTemplateVersionUnchanged(collections.templateVersions, release.templateId, version);
  }
  for (const version of release.versions) {
    await upsertTemplateVersion(collections.templateVersions, release.templateId, version, now);
  }

  const current = release.versions.find((version) => versionOf(version) === release.currentVersion);
  if (!current) throw new Error(`Missing current version of template ${release.templateId}`);
  await collections.templates.updateOne(
    { _id: release.templateId },
    {
      $set: {
        currentVersion: release.currentVersion,
        sortOrder,
        status: current.status,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}
