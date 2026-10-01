import {
  COLLECTIONS,
  getDatabase,
  getMongoClient,
  runDatabaseMigrations,
  verifyDatabaseSchema,
} from "../packages/database/src/index";

import { seedTemplateReleases } from "../apps/web/src/modules/templates/infrastructure/seed-template-catalog";
import { seedTemplateRelease } from "../apps/web/src/modules/templates/infrastructure/template-release-seed";

async function seedTemplates(): Promise<void> {
  const database = await getDatabase();
  const now = new Date();
  const collections = {
    templates: database.collection<{ _id: string }>(COLLECTIONS.templates),
    templateVersions: database.collection<{ _id: string; manifest: unknown }>(
      COLLECTIONS.templateVersions,
    ),
  };

  // Stored template releases are immutable: seeding aborts before writing a template whose stored
  // manifest differs from the seed (see docs/runbooks/passwordless-auth.md).
  for (const [sortOrder, release] of seedTemplateReleases.entries()) {
    await seedTemplateRelease(collections, release, sortOrder, now);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const database = await getDatabase();

  switch (command) {
    case "migrate":
      await runDatabaseMigrations(database, (collection, phase) => {
        process.stdout.write(
          `${JSON.stringify({ collection, event: "database_migration", phase })}\n`,
        );
      });
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
