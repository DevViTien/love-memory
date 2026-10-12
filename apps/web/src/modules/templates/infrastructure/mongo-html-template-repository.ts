import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { type ClientSession, type Db, type MongoClient } from "mongodb";

import { buildAuditRecord } from "@/modules/admin/application/audit";
import { insertAuditRecord } from "@/modules/admin/infrastructure/mongo-audit-log";

import {
  type HtmlTemplateRepository,
  type HtmlTemplateVersionRecord,
  type StoredHtmlTemplateFile,
  type StoredTemplateVersionIdentity,
} from "../application/import-html-template";
import { compareSemanticVersions } from "../application/semantic-version-order";

type TemplateStatus = "draft" | "published" | "retired";

/** A `templateVersions` document of either kind; `html` fields are absent on `sdk` versions. */
type TemplateVersionDocument = Readonly<{
  _id: string;
  adminRetiredAt?: Date;
  artifactContentHash?: string;
  contentHash?: string;
  createdAt: Date;
  defaults?: Readonly<Record<string, unknown>>;
  files?: readonly StoredHtmlTemplateFile[];
  importedAt?: Date;
  kind?: "html" | "sdk";
  manifest: Readonly<Record<string, unknown>>;
  status: TemplateStatus;
  templateId: string;
  updatedAt: Date;
  version: string;
}>;

type TemplateDocument = Readonly<{
  _id: string;
  createdAt: Date;
  currentVersion: string;
  sortOrder: number;
  status: TemplateStatus;
  updatedAt: Date;
}>;

/** The stored artifact of an `html` version: its content address and files. */
export type HtmlTemplateArtifactRecord = Readonly<{
  artifactContentHash: string;
  files: readonly StoredHtmlTemplateFile[];
}>;

function versionId(templateId: string, version: string): string {
  return `${templateId}@${version}`;
}

async function updateTemplate(
  database: Db,
  session: ClientSession,
  input: Readonly<{
    now: Date;
    publish: boolean;
    sortOrder: number | null;
    templateId: string;
    version: string;
  }>,
): Promise<void> {
  const templates = database.collection<TemplateDocument>(COLLECTIONS.templates);
  const existing = await templates.findOne({ _id: input.templateId }, { session });
  if (!existing) {
    const sortOrder = input.sortOrder ?? (await templates.countDocuments({}, { session }));
    await templates.insertOne(
      {
        _id: input.templateId,
        createdAt: input.now,
        currentVersion: input.version,
        sortOrder,
        status: input.publish ? "published" : "draft",
        updatedAt: input.now,
      },
      { session },
    );
    return;
  }
  if (!input.publish) return;

  const current = await database
    .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
    .findOne({ _id: versionId(input.templateId, existing.currentVersion) }, { session });
  // A newer published version stays current; a draft or retired current version is replaced.
  const keepsCurrent =
    current?.status === "published" &&
    compareSemanticVersions(existing.currentVersion, input.version) > 0;
  if (keepsCurrent) return;
  await templates.updateOne(
    { _id: input.templateId },
    { $set: { currentVersion: input.version, status: "published", updatedAt: input.now } },
    { session },
  );
}

/** The `templateVersions` reads and writes of `html` templates. */
export function createMongoHtmlTemplateRepository(
  dependencies: Readonly<{
    database: () => Promise<Db>;
    client: () => Promise<Pick<MongoClient, "withSession">>;
  }> = { client: getMongoClient, database: getDatabase },
): HtmlTemplateRepository &
  Readonly<{
    findArtifact(templateId: string, version: string): Promise<HtmlTemplateArtifactRecord | null>;
  }> {
  return {
    async findArtifact(templateId, version) {
      const database = await dependencies.database();
      const document = await database
        .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
        .findOne(
          { _id: versionId(templateId, version), kind: "html" },
          { projection: { artifactContentHash: 1, files: 1 } },
        );
      if (!document?.artifactContentHash || !Array.isArray(document.files)) return null;
      return { artifactContentHash: document.artifactContentHash, files: document.files };
    },

    async findVersion(templateId, version) {
      const database = await dependencies.database();
      const document = await database
        .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
        .findOne(
          { _id: versionId(templateId, version) },
          { projection: { artifactContentHash: 1, contentHash: 1, status: 1 } },
        );
      if (!document) return null;
      const identity: StoredTemplateVersionIdentity = {
        artifactContentHash: document.artifactContentHash ?? null,
        contentHash: document.contentHash ?? null,
        status: document.status,
      };
      return identity;
    },

    async saveImport({ now, operator, publish, record, sortOrder, stored }) {
      const [database, client] = await Promise.all([
        dependencies.database(),
        dependencies.client(),
      ]);
      await client.withSession((session) =>
        session.withTransaction(async () => {
          await saveVersion(database, session, { now, publish, record, stored });
          await updateTemplate(database, session, {
            now,
            publish,
            sortOrder,
            templateId: record.templateId,
            version: record.version,
          });
          await insertAuditRecord(
            database,
            buildAuditRecord(
              {
                action: "admin.template.imported",
                actor: { id: operator, kind: "operator" },
                metadata: {
                  artifactHash: record.artifactContentHash,
                  files: record.files.length,
                  published: publish,
                },
                target: {
                  id: versionId(record.templateId, record.version),
                  kind: "template-version",
                },
              },
              null,
              now,
            ),
            session,
          );
        }),
      );
    },
  };
}

async function saveVersion(
  database: Db,
  session: ClientSession,
  input: Readonly<{
    now: Date;
    publish: boolean;
    record: HtmlTemplateVersionRecord;
    stored: StoredTemplateVersionIdentity | null;
  }>,
): Promise<void> {
  const versions = database.collection<TemplateVersionDocument>(COLLECTIONS.templateVersions);
  const { record } = input;
  const _id = versionId(record.templateId, record.version);
  if (input.stored) {
    // Only a stored draft changes, and only to published; an admin's retire or kill stays.
    const updated = await versions.updateOne(
      { _id, adminRetiredAt: { $exists: false }, status: "draft" },
      { $set: { status: "published", updatedAt: input.now } },
      { session },
    );
    if (updated.matchedCount !== 1) throw new Error(`Template version ${_id} changed meanwhile.`);
    return;
  }
  await versions.insertOne(
    {
      _id,
      artifactContentHash: record.artifactContentHash,
      contentHash: record.contentHash,
      createdAt: input.now,
      defaults: record.defaults,
      files: record.files,
      importedAt: input.now,
      kind: "html",
      manifest: record.manifest,
      status: input.publish ? "published" : "draft",
      templateId: record.templateId,
      updatedAt: input.now,
      version: record.version,
    },
    { session },
  );
}

export const mongoHtmlTemplateRepository = createMongoHtmlTemplateRepository();
