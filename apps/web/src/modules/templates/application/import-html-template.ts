import { manifestContentHash } from "./template-manifest-hash";
import {
  type HtmlTemplateFile,
  HtmlTemplateImportError,
  type HtmlTemplateSource,
  prepareHtmlTemplate,
} from "./html-template-import";

/** A stored file of an `html` template version (`templateVersions.files`). */
export type StoredHtmlTemplateFile = Readonly<{
  contentType: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  storageKey: string;
}>;

/** What an import needs to know about an already stored `<templateId>@<version>`. */
export type StoredTemplateVersionIdentity = Readonly<{
  /** `null` for an `sdk` version, which has no stored artifact. */
  artifactContentHash: string | null;
  contentHash: string | null;
  status: "draft" | "published" | "retired";
}>;

export type HtmlTemplateVersionRecord = Readonly<{
  artifactContentHash: string;
  contentHash: string;
  defaults: Readonly<Record<string, unknown>>;
  files: readonly StoredHtmlTemplateFile[];
  manifest: Readonly<Record<string, unknown>>;
  templateId: string;
  version: string;
}>;

export interface HtmlTemplateRepository {
  findVersion(templateId: string, version: string): Promise<StoredTemplateVersionIdentity | null>;
  /**
   * In one transaction: stores the version (new) or publishes it (existing draft), points the
   * template at it when published and newer, and writes the `admin.template.imported` record.
   */
  saveImport(
    input: Readonly<{
      now: Date;
      operator: string;
      publish: boolean;
      record: HtmlTemplateVersionRecord;
      /** The `sortOrder` of a template stored for the first time; `null` appends it. */
      sortOrder: number | null;
      stored: StoredTemplateVersionIdentity | null;
    }>,
  ): Promise<void>;
}

export interface HtmlTemplateFileStore {
  /** Writes a content-addressed file; a file already at that key is kept. */
  putFile(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export type HtmlTemplateImportOutcome = "imported" | "published" | "unchanged";

export type HtmlTemplateImportSummary = Readonly<{
  artifactContentHash: string;
  event: "template_import";
  files: number;
  initialJsKbGzip: number;
  initialMediaKb: number;
  outcome: HtmlTemplateImportOutcome;
  status: "draft" | "published" | "retired";
  templateId: string;
  version: string;
}>;

/** `private/templates/<id>/<version>/<artifactContentHash>/<file>`. */
export function htmlTemplateStorageKey(
  templateId: string,
  version: string,
  artifactContentHash: string,
  name: string,
): string {
  return `private/templates/${templateId}/${version}/${artifactContentHash}/${name}`;
}

function toStoredFile(
  file: HtmlTemplateFile,
  templateId: string,
  version: string,
  artifactContentHash: string,
): StoredHtmlTemplateFile {
  return {
    contentType: file.contentType,
    name: file.name,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    storageKey: htmlTemplateStorageKey(templateId, version, artifactContentHash, file.name),
  };
}

/**
 * `pnpm template:import` and the seed (`template-artifact-delivery` "HTML template import"): checks
 * the folder, refuses a different artifact or manifest under an existing version, writes the files
 * to object storage, then stores the version with its audit record. Importing the same folder again
 * changes nothing, except that `publish` publishes a stored draft; the files are written again only
 * where missing, so a store that lost them is repaired.
 */
export function createHtmlTemplateImporter({
  clock = () => new Date(),
  files,
  repository,
}: Readonly<{
  clock?: () => Date;
  files: HtmlTemplateFileStore;
  repository: HtmlTemplateRepository;
}>) {
  return {
    async importTemplate(
      source: HtmlTemplateSource,
      options: Readonly<{ operator: string; publish: boolean; sortOrder?: number | null }>,
    ): Promise<HtmlTemplateImportSummary> {
      const prepared = prepareHtmlTemplate(source);
      const { id: templateId, version } = prepared.manifest;
      const contentHash = manifestContentHash(prepared.storedManifest);
      const stored = await repository.findVersion(templateId, version);
      if (
        stored &&
        (stored.artifactContentHash !== prepared.artifactContentHash ||
          stored.contentHash !== contentHash)
      ) {
        throw new HtmlTemplateImportError([
          `${templateId}@${version} is already stored with other content: a template version is immutable, so give the change a new version.`,
        ]);
      }

      for (const file of prepared.files) {
        await files.putFile(
          htmlTemplateStorageKey(templateId, version, prepared.artifactContentHash, file.name),
          file.body,
          file.contentType,
        );
      }

      const publishes = options.publish && stored?.status === "draft";
      const outcome: HtmlTemplateImportOutcome = !stored
        ? "imported"
        : publishes
          ? "published"
          : "unchanged";
      if (outcome !== "unchanged") {
        await repository.saveImport({
          now: clock(),
          operator: options.operator,
          publish: options.publish,
          record: {
            artifactContentHash: prepared.artifactContentHash,
            contentHash,
            defaults: prepared.defaults,
            files: prepared.files.map((file) =>
              toStoredFile(file, templateId, version, prepared.artifactContentHash),
            ),
            manifest: prepared.storedManifest,
            templateId,
            version,
          },
          sortOrder: options.sortOrder ?? null,
          stored,
        });
      }

      return {
        artifactContentHash: prepared.artifactContentHash,
        event: "template_import",
        files: prepared.files.length,
        initialJsKbGzip: prepared.metrics.initialJsKbGzip,
        initialMediaKb: prepared.metrics.initialMediaKb,
        outcome,
        status:
          outcome === "unchanged" && stored
            ? stored.status
            : options.publish
              ? "published"
              : "draft",
        templateId,
        version,
      };
    },
  } as const;
}

export type HtmlTemplateImporter = ReturnType<typeof createHtmlTemplateImporter>;
