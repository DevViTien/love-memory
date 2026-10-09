import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { type Document, type Filter } from "mongodb";

import { type AuditAction, buildAuditRecord } from "@/modules/admin/application/audit";
import { insertAuditRecord } from "@/modules/admin/infrastructure/mongo-audit-log";

import {
  type TemplateKillReason,
  type TemplateVersionState,
  type TemplateVersionStateRepository,
  type TemplateVersionTransition,
} from "../application/template-version-controls";

type TemplateVersionDocument = Readonly<{
  _id: string;
  adminRetiredAt?: Date;
  killReason?: TemplateKillReason | null;
  killedAt?: Date | null;
  status: TemplateVersionState["status"];
  templateId: string;
  version: string;
}>;

type TemplateDocument = Readonly<{ _id: string; currentVersion: string }>;

const AUDIT_ACTIONS: Readonly<Record<TemplateVersionTransition["action"], AuditAction>> = {
  kill: "admin.template.killed",
  restore: "admin.template.restored",
  retire: "admin.template.retired",
};

const STATE_PROJECTION = {
  _id: 1,
  killReason: 1,
  killedAt: 1,
  status: 1,
  templateId: 1,
  version: 1,
} as const;

function versionId(templateId: string, version: string): string {
  return `${templateId}@${version}`;
}

/** Numeric-aware, newest first: `1.10.0` before `1.9.0`. */
function compareVersionsDescending(left: string, right: string): number {
  return right.localeCompare(left, "en", { numeric: true });
}

function toState(document: TemplateVersionDocument, currentVersion: string | undefined) {
  const killed = document.killedAt instanceof Date;
  return {
    current: currentVersion === document.version,
    killReason: killed ? (document.killReason ?? null) : null,
    killed,
    status: document.status,
    templateId: document.templateId,
    version: document.version,
  } satisfies TemplateVersionState;
}

/** Each transition matches only when it changes something (design Decision 3). */
function transitionUpdate(
  input: TemplateVersionTransition,
): Readonly<{ filter: Filter<TemplateVersionDocument>; update: Document[] }> {
  const _id = versionId(input.templateId, input.version);
  switch (input.action) {
    case "retire":
      return {
        filter: { _id, status: "published" },
        update: [{ $set: { adminRetiredAt: input.now, status: "retired", updatedAt: input.now } }],
      };
    case "kill":
      return {
        filter: {
          _id,
          killedAt: { $not: { $type: "date" } },
          status: { $in: ["published", "retired"] },
        },
        update: [
          {
            $set: {
              adminRetiredAt: { $ifNull: ["$adminRetiredAt", input.now] },
              killReason: input.reason ?? "other",
              killedAt: input.now,
              status: "retired",
              updatedAt: input.now,
            },
          },
        ],
      };
    case "restore":
      return {
        filter: { _id, killedAt: { $type: "date" } },
        update: [{ $set: { killReason: null, killedAt: null, updatedAt: input.now } }],
      };
  }
}

export const mongoTemplateVersionState: TemplateVersionStateRepository = {
  async findState(templateId, version) {
    const database = await getDatabase();
    const [document, template] = await Promise.all([
      database
        .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
        .findOne({ _id: versionId(templateId, version) }, { projection: STATE_PROJECTION }),
      database
        .collection<TemplateDocument>(COLLECTIONS.templates)
        .findOne({ _id: templateId }, { projection: { currentVersion: 1 } }),
    ]);
    return document ? toState(document, template?.currentVersion) : null;
  },

  async isKilled(templateId, version) {
    const killed = await (
      await getDatabase()
    )
      .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
      .findOne(
        { _id: versionId(templateId, version), killedAt: { $type: "date" } },
        { projection: { _id: 1 } },
      );
    return killed !== null;
  },

  async listVersions() {
    const database = await getDatabase();
    const [documents, templates] = await Promise.all([
      database
        .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
        .find({}, { projection: STATE_PROJECTION })
        .toArray(),
      database
        .collection<TemplateDocument>(COLLECTIONS.templates)
        .find({}, { projection: { currentVersion: 1 } })
        .toArray(),
    ]);
    const currentVersions = new Map(
      templates.map((template) => [template._id, template.currentVersion]),
    );
    return documents
      .map((document) => toState(document, currentVersions.get(document.templateId)))
      .sort(
        (left, right) =>
          left.templateId.localeCompare(right.templateId) ||
          compareVersionsDescending(left.version, right.version),
      );
  },

  async transition(input) {
    const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
    const { filter, update } = transitionUpdate(input);
    let changed = false;
    await client.withSession((session) =>
      session.withTransaction(async () => {
        changed = false;
        const result = await database
          .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
          .updateOne(filter, update, { session });
        if (result.modifiedCount === 0) return;
        await insertAuditRecord(
          database,
          buildAuditRecord(
            {
              action: AUDIT_ACTIONS[input.action],
              actor: { id: input.actorId, kind: "admin" },
              ...(input.action === "kill" ? { metadata: { reason: input.reason ?? "other" } } : {}),
              target: {
                id: versionId(input.templateId, input.version),
                kind: "template-version",
              },
            },
            input.requestId,
            input.now,
          ),
          session,
        );
        changed = true;
      }),
    );
    return changed;
  },
};
