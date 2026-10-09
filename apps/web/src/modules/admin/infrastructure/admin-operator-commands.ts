import { COLLECTIONS } from "@love-memory/database";
import { type ClientSession, type Db, type MongoClient } from "mongodb";

import { type AuditAction, buildAuditRecord } from "../application/audit";
import { authIdString } from "./better-auth-ids";
import { insertAuditRecord } from "./mongo-audit-log";

export type AdminCommandName = "grant" | "reset-mfa" | "revoke";

export type AdminCommand = Readonly<{
  command: AdminCommandName;
  email: string;
  operator: string;
}>;

/** One JSON line per command: the user id and the outcome, never the email. */
export type AdminCommandResult = Readonly<{
  command: AdminCommandName;
  event: "admin_command";
  outcome: "changed" | "unchanged";
  userId: string;
}>;

const USAGE =
  "Usage: pnpm admin:<grant|revoke|reset-mfa> <email> --operator <name> (the operator is recorded in the audit log)";

const COMMANDS: readonly AdminCommandName[] = ["grant", "revoke", "reset-mfa"];

/** Parses `<command> <email> --operator <name>`; every part is required. */
export function parseAdminCommand(argv: readonly string[]): AdminCommand {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command as AdminCommandName)) throw new Error(USAGE);

  let email: string | undefined;
  let operator: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--operator") {
      operator = rest[index + 1]?.trim();
      index += 1;
    } else if (argument?.startsWith("--operator=")) {
      operator = argument.slice("--operator=".length).trim();
    } else if (email === undefined) {
      email = argument?.trim().toLowerCase();
    } else {
      throw new Error(USAGE);
    }
  }

  if (!email) throw new Error(USAGE);
  if (!operator || operator.startsWith("--") || operator.length > 200) {
    throw new Error(`Missing operator name. ${USAGE}`);
  }
  return { command: command as AdminCommandName, email, operator };
}

/** `_id` is a BSON UUID when Better Auth created the user (see `better-auth-ids.ts`). */
type UserDocument = Readonly<{ _id: unknown; email: string; role?: string }>;

const AUDIT_ACTIONS: Readonly<Record<AdminCommandName, AuditAction>> = {
  grant: "admin.role.granted",
  "reset-mfa": "admin.mfa.reset",
  revoke: "admin.role.revoked",
};

/**
 * Ends every session of the user, and with them every admin step-up. Sessions reference the stored
 * user id (a UUID); step-ups hold the string form the application sees.
 */
async function endSessions(
  database: Db,
  user: Readonly<{ id: string; storedId: unknown }>,
  session: ClientSession,
): Promise<void> {
  await database
    .collection(COLLECTIONS.sessions)
    .deleteMany({ userId: user.storedId }, { session });
  await database.collection(COLLECTIONS.adminStepUps).deleteMany({ userId: user.id }, { session });
}

/**
 * `admin:grant`, `admin:revoke`, `admin:reset-mfa` (`admin-access` "Admin role and operator
 * commands"): one transaction per command, so a change never exists without its audit record.
 * Granting an admin or revoking a creator changes and records nothing.
 */
export async function runAdminCommand(
  database: Db,
  client: Pick<MongoClient, "withSession">,
  { command, email, operator }: AdminCommand,
  now: Date = new Date(),
): Promise<AdminCommandResult> {
  let result: AdminCommandResult | undefined;

  await client.withSession((session) =>
    session.withTransaction(async () => {
      result = undefined;
      const users = database.collection<UserDocument>(COLLECTIONS.users);
      const user = await users.findOne(
        { email },
        { projection: { _id: 1, email: 1, role: 1 }, session },
      );
      if (!user) throw new Error(`User not found: ${email}`);
      const userId = authIdString(user._id);
      const target = { id: userId, storedId: user._id };
      const isAdmin = user.role === "admin";

      if ((command === "grant" && isAdmin) || (command === "revoke" && !isAdmin)) {
        result = { command, event: "admin_command", outcome: "unchanged", userId };
        return;
      }

      if (command === "grant") {
        await users.updateOne(
          { _id: user._id },
          { $set: { role: "admin", updatedAt: now } },
          { session },
        );
      } else if (command === "revoke") {
        await users.updateOne(
          { _id: user._id },
          { $set: { role: "creator", updatedAt: now } },
          { session },
        );
        await endSessions(database, target, session);
      } else {
        // The factor and its lock go with the record; the admin enrolls again at `/admin/mfa`.
        await database
          .collection(COLLECTIONS.twoFactors)
          .deleteMany({ userId: user._id }, { session });
        await users.updateOne(
          { _id: user._id },
          { $set: { twoFactorEnabled: false, updatedAt: now } },
          { session },
        );
        await endSessions(database, target, session);
      }

      await insertAuditRecord(
        database,
        buildAuditRecord(
          {
            action: AUDIT_ACTIONS[command],
            actor: { id: operator, kind: "operator" },
            target: { id: userId, kind: "user" },
          },
          null,
          now,
        ),
        session,
      );
      result = { command, event: "admin_command", outcome: "changed", userId };
    }),
  );

  if (!result) throw new Error("The admin command did not complete.");
  return result;
}
