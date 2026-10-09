import { createHash } from "node:crypto";

import { type AuditRecord } from "./audit";

/** A step-up stays valid this long, bound to one session (`admin-access`). */
export const ADMIN_STEP_UP_MILLISECONDS = 12 * 60 * 60 * 1000;

export type AdminUser = Readonly<{
  email: string;
  id: string;
  role: "admin" | "creator";
  twoFactorEnabled: boolean;
}>;

export type AdminSession = Readonly<{ sessionId: string; user: AdminUser }>;

export type AdminAccess =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "needs-enrollment"; session: AdminSession }>
  | Readonly<{ kind: "needs-step-up"; session: AdminSession }>
  | Readonly<{ kind: "admin"; session: AdminSession }>;

export type AdminStepUp = Readonly<{
  expiresAt: Date;
  /** `stepUpKey(sessionId)`. */
  key: string;
  userId: string;
  verifiedAt: Date;
}>;

export interface AdminStepUpRepository {
  /** Whether this session's step-up of this user is still valid at `now`. */
  hasValid(sessionKey: string, userId: string, now: Date): Promise<boolean>;
  /** Stores the step-up and its audit record in one transaction: neither exists without the other. */
  record(stepUp: AdminStepUp, audit: AuditRecord): Promise<void>;
}

/** Step-ups are stored under a hash of the session id, never the id itself. */
export function stepUpKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

/**
 * The admin-area decision (`admin-access` "Admin area guard"), made before any admin data is read:
 * not an admin (`none`), an admin who must enroll or step up, or an admin with a valid step-up.
 */
export async function resolveAdminAccess({
  now,
  session,
  stepUps,
}: Readonly<{
  now: Date;
  session: AdminSession | null;
  stepUps: Pick<AdminStepUpRepository, "hasValid">;
}>): Promise<AdminAccess> {
  if (session?.user.role !== "admin") return { kind: "none" };
  if (!session.user.twoFactorEnabled) return { kind: "needs-enrollment", session };
  const valid = await stepUps.hasValid(stepUpKey(session.sessionId), session.user.id, now);
  return valid ? { kind: "admin", session } : { kind: "needs-step-up", session };
}

/** Records a step-up for the session, valid for 12 hours, together with its audit record. */
export async function recordStepUp(
  repository: Pick<AdminStepUpRepository, "record">,
  session: AdminSession,
  now: Date,
  audit: AuditRecord,
): Promise<void> {
  await repository.record(
    {
      expiresAt: new Date(now.getTime() + ADMIN_STEP_UP_MILLISECONDS),
      key: stepUpKey(session.sessionId),
      userId: session.user.id,
      verifiedAt: now,
    },
    audit,
  );
}
