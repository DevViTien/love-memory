import { parseTemplateManifest, parseTemplatePayload } from "@love-memory/template-sdk";
import { canonicalJson, manifestContentHash } from "../application/template-manifest-hash";

export { canonicalJson, manifestContentHash };

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

/** The collection methods the seed uses, so tests can pass a fake collection. */
export type SeedCollection = Readonly<{
  findOne: (filter: Readonly<{ _id: string }>) => Promise<Readonly<{ manifest?: unknown }> | null>;
  updateOne: (
    filter: Readonly<{ _id: string; adminRetiredAt?: Readonly<{ $exists: false }> }>,
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
 * `sha256(canonicalJson(manifest))`; an existing document keeps them and only gets its `status`,
 * unless an admin retired or killed it (`template-version-controls`): that decision stays.
 */
export async function upsertTemplateVersion(
  collection: SeedCollection,
  templateId: string,
  version: SeedTemplateVersion,
  now: Date,
): Promise<void> {
  await assertTemplateVersionUnchanged(collection, templateId, version);
  const versionId = versionOf(version);
  const _id = `${templateId}@${versionId}`;
  await collection.updateOne(
    { _id },
    {
      $set: { updatedAt: now },
      $setOnInsert: {
        contentHash: manifestContentHash(version.manifest),
        createdAt: now,
        manifest: version.manifest,
        previewFixture: version.previewFixture,
        status: version.status,
        templateId,
        version: versionId,
      },
    },
    { upsert: true },
  );
  await collection.updateOne(
    { _id, adminRetiredAt: { $exists: false } },
    { $set: { status: version.status } },
    { upsert: false },
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
