import {
  parseAdminCommand,
  runAdminCommand,
} from "@/modules/admin/infrastructure/admin-operator-commands";
import { getDatabase, getMongoClient } from "../packages/database/src/index";

// Operator commands for the admin role and factor (`admin-access`): one JSON line with the user id
// and the outcome, never the email. Every change is recorded in the audit log in its transaction.
try {
  const command = parseAdminCommand(process.argv.slice(2));
  const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
  const result = await runAdminCommand(database, client, command);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
