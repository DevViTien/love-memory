import { createHash } from "node:crypto";

import {
  COLLECTIONS,
  getDatabase,
  getMongoClient,
  runDatabaseMigrations,
  verifyDatabaseSchema,
} from "../packages/database/src/index";
import { parseTemplatePayload } from "../packages/template-sdk/src/index";

import { seedTemplateManifests } from "../apps/web/src/modules/templates/infrastructure/seed-template-catalog";

const previewFixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "memory-box": {
    "final-message": "Cảm ơn vì đã cùng mình tạo nên những ký ức thật đẹp.",
    headline: "Mở hộp ký ức của chúng mình",
    photos: ["fixture-photo-1", "fixture-photo-2", "fixture-photo-3"],
  },
  "midnight-wish": {
    "receiver-name": "Người thương",
    wishes: "Mỗi vì sao là một điều mình trân trọng về chúng ta.",
  },
  "our-timeline": {
    milestones: ["fixture-photo-1", "fixture-photo-2", "fixture-photo-3", "fixture-photo-4"],
    title: "Hành trình của hai đứa",
  },
};

type TemplateDocument = Readonly<{
  _id: string;
  createdAt: Date;
  currentVersion: string;
  sortOrder: number;
  status: string;
  updatedAt: Date;
}>;

type TemplateVersionDocument = Readonly<{
  _id: string;
  contentHash: string;
  createdAt: Date;
  manifest: unknown;
  previewFixture: Readonly<Record<string, unknown>>;
  status: string;
  templateId: string;
  updatedAt: Date;
  version: string;
}>;

async function seedTemplates(): Promise<void> {
  const database = await getDatabase();
  const now = new Date();

  for (const [sortOrder, manifest] of seedTemplateManifests.entries()) {
    const previewFixture = previewFixtures[manifest.id];
    if (!previewFixture) {
      throw new Error(`Missing preview fixture for template: ${manifest.id}`);
    }

    parseTemplatePayload(manifest, previewFixture);
    const contentHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

    await database.collection<TemplateDocument>(COLLECTIONS.templates).updateOne(
      { _id: manifest.id },
      {
        $set: {
          currentVersion: manifest.version,
          sortOrder,
          status: manifest.status,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    await database.collection<TemplateVersionDocument>(COLLECTIONS.templateVersions).updateOne(
      { _id: `${manifest.id}@${manifest.version}` },
      {
        $set: {
          contentHash,
          manifest,
          previewFixture,
          status: manifest.status,
          templateId: manifest.id,
          updatedAt: now,
          version: manifest.version,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const database = await getDatabase();

  switch (command) {
    case "migrate":
      await runDatabaseMigrations(database);
      await verifyDatabaseSchema(database);
      break;
    case "seed":
      await runDatabaseMigrations(database);
      await seedTemplates();
      await verifyDatabaseSchema(database);
      break;
    case "verify":
      await verifyDatabaseSchema(database);
      break;
    default:
      throw new Error("Expected database command: migrate, seed, or verify.");
  }
}

try {
  await main();
  process.stdout.write("Database command completed successfully.\n");
} finally {
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
