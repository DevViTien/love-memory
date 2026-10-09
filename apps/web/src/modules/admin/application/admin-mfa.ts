import { type AdminSession, type AdminStepUpRepository, recordStepUp } from "./admin-access";
import { type AuditService, buildAuditRecord } from "./audit";

/** After this many consecutive wrong codes the factor is locked (`admin-access` "Admin step-up"). */
export const ADMIN_MFA_MAX_FAILED_ATTEMPTS = 10;
export const ADMIN_MFA_LOCK_MILLISECONDS = 15 * 60 * 1000;

const TOTP_CODE = /^\d{6}$/;

export type AdminFactorMethod = "backup" | "totp";

/**
 * A verified code, and the session the step-up belongs to: the first code of an enrollment rotates
 * the session, so `sessionId` and the `Set-Cookie` values to forward come from the provider.
 */
export type FactorVerification =
  | Readonly<{ ok: false }>
  | Readonly<{ ok: true; sessionId: string; setCookies: readonly string[] }>;

/** The authenticator-app factor (Better Auth's `twoFactor` plugin, called on the server only). */
export interface AdminFactorProvider {
  /** Creates or replaces the pending secret and backup codes. */
  enable(headers: Headers): Promise<Readonly<{ backupCodes: readonly string[]; totpUri: string }>>;
  verify(
    input: Readonly<{
      code: string;
      headers: Headers;
      method: AdminFactorMethod;
      sessionId: string;
    }>,
  ): Promise<FactorVerification>;
}

/** Consecutive failed codes per admin; the plugin applies its own lockout only to sign-ins. */
export interface AdminMfaLockout {
  clear(userId: string): Promise<void>;
  /** The end of an active lock, or `null`. */
  lockedUntil(userId: string, now: Date): Promise<Date | null>;
  recordFailure(userId: string, now: Date): Promise<void>;
}

export type AdminEnrollment =
  | Readonly<{ kind: "already-enabled" }>
  | Readonly<{
      backupCodes: readonly string[];
      kind: "enrolled";
      setupKey: string;
      totpUri: string;
    }>;

export type AdminVerification =
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "locked"; retryAfterSeconds: number }>
  | Readonly<{ kind: "verified"; setCookies: readonly string[] }>;

export type AdminMfaDependencies = Readonly<{
  audit: Pick<AuditService, "record">;
  clock?: () => Date;
  factor: AdminFactorProvider;
  lockout: AdminMfaLockout;
  stepUps: Pick<AdminStepUpRepository, "record">;
}>;

/** The base32 secret an authenticator app accepts when typed in instead of scanned. */
function setupKeyOf(totpUri: string): string {
  const setupKey = new URL(totpUri).searchParams.get("secret");
  if (!setupKey) throw new Error("TOTP_URI_WITHOUT_SECRET");
  return setupKey;
}

/**
 * Admin second factor (`admin-access`): enrollment for an admin without an enabled factor, and the
 * per-session step-up. The submitted code never leaves this function: not into a log, not into an
 * audit record (only the method and an outcome reason are recorded).
 */
export function createAdminMfaService({
  audit,
  clock = () => new Date(),
  factor,
  lockout,
  stepUps,
}: AdminMfaDependencies) {
  async function enroll(session: AdminSession, headers: Headers): Promise<AdminEnrollment> {
    if (session.user.twoFactorEnabled) return { kind: "already-enabled" };
    const { backupCodes, totpUri } = await factor.enable(headers);
    return { backupCodes, kind: "enrolled", setupKey: setupKeyOf(totpUri), totpUri };
  }

  async function verify(
    input: Readonly<{ code: string; headers: Headers; requestId: string; session: AdminSession }>,
  ): Promise<AdminVerification> {
    const { session } = input;
    const now = clock();
    const actor = { id: session.user.id, kind: "admin" } as const;
    const target = { id: session.user.id, kind: "user" } as const;
    const method: AdminFactorMethod = TOTP_CODE.test(input.code) ? "totp" : "backup";

    const lockedUntil = await lockout.lockedUntil(session.user.id, now);
    if (lockedUntil) {
      await audit.record(
        { action: "admin.mfa.failed", actor, metadata: { method, reason: "locked" }, target },
        input.requestId,
      );
      return {
        kind: "locked",
        retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)),
      };
    }

    // Before the factor is enabled only an authenticator code can activate it.
    const enrolling = !session.user.twoFactorEnabled;
    const verification: FactorVerification =
      enrolling && method === "backup"
        ? { ok: false }
        : await factor.verify({
            code: input.code,
            headers: input.headers,
            method,
            sessionId: session.sessionId,
          });

    if (!verification.ok) {
      await lockout.recordFailure(session.user.id, now);
      await audit.record(
        { action: "admin.mfa.failed", actor, metadata: { method, reason: "invalid" }, target },
        input.requestId,
      );
      return { kind: "invalid" };
    }

    await lockout.clear(session.user.id);
    await recordStepUp(
      stepUps,
      { sessionId: verification.sessionId, user: session.user },
      now,
      buildAuditRecord(
        {
          action: enrolling ? "admin.mfa.enrolled" : "admin.mfa.verified",
          actor,
          metadata: { method },
          target,
        },
        input.requestId,
        now,
      ),
    );
    return { kind: "verified", setCookies: verification.setCookies };
  }

  return { enroll, verify } as const;
}

export type AdminMfaService = ReturnType<typeof createAdminMfaService>;
