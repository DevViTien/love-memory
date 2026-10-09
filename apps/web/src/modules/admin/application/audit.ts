import { randomUUID } from "node:crypto";
import { z } from "zod";

/** Audit records live this long; the expiry index removes them afterwards (`audit-log`). */
export const AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1000;

export const AuditActionSchema = z.enum([
  "admin.role.granted",
  "admin.role.revoked",
  "admin.mfa.enrolled",
  "admin.mfa.reset",
  "admin.mfa.verified",
  "admin.mfa.failed",
  "admin.gift.looked_up",
  "admin.template.retired",
  "admin.template.killed",
  "admin.template.restored",
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditActorSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(["admin", "operator", "system"]),
  })
  .strict();

export const AuditTargetSchema = z
  .object({ id: z.string().min(1).max(200), kind: z.string().min(1).max(40) })
  .strict();

/**
 * Keys that would carry personal data or a credential: never allowed, whatever the value. Error
 * codes (`failureCode`) are fine; a bare `code` would be a TOTP or backup code.
 */
const FORBIDDEN_METADATA_KEY = /^code$|backup|email|token|share|password|secret|url|content/i;

/** Identifiers and codes only: at most 10 keys, short scalar values, no sensitive key names. */
export const AuditMetadataSchema = z
  .record(z.string().min(1).max(40), z.union([z.boolean(), z.number(), z.string().max(100)]))
  .refine((metadata) => Object.keys(metadata).length <= 10, {
    message: "Audit metadata holds at most 10 keys.",
  })
  .refine((metadata) => Object.keys(metadata).every((key) => !FORBIDDEN_METADATA_KEY.test(key)), {
    message: "Audit metadata must not hold personal data or credentials.",
  });

export const AuditInputSchema = z
  .object({
    action: AuditActionSchema,
    actor: AuditActorSchema,
    metadata: AuditMetadataSchema.default({}),
    target: AuditTargetSchema.nullable(),
  })
  .strict();

export type AuditInput = z.input<typeof AuditInputSchema>;

export type AuditRecord = Readonly<{
  action: AuditAction;
  actor: z.infer<typeof AuditActorSchema>;
  at: Date;
  expiresAt: Date;
  id: string;
  metadata: Readonly<Record<string, boolean | number | string>>;
  requestId: string | null;
  target: z.infer<typeof AuditTargetSchema> | null;
}>;

/** Append-only by construction: the port has no update or delete. */
export interface AuditLogRepository {
  insert(record: AuditRecord): Promise<void>;
  listLatest(
    input: Readonly<{ limit: number; targetId?: string }>,
  ): Promise<readonly AuditRecord[]>;
}

/** Builds a complete record: id, server time and the one-year expiry. Throws on a bad input. */
export function buildAuditRecord(
  input: AuditInput,
  requestId: string | null,
  now: Date,
  createId: () => string = randomUUID,
): AuditRecord {
  const parsed = AuditInputSchema.parse(input);
  return {
    action: parsed.action,
    actor: parsed.actor,
    at: now,
    expiresAt: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
    id: createId(),
    metadata: parsed.metadata,
    requestId,
    target: parsed.target,
  };
}

export function createAuditService({
  clock = () => new Date(),
  repository,
}: Readonly<{ clock?: () => Date; repository: AuditLogRepository }>) {
  return {
    listLatest: (input: Readonly<{ limit: number; targetId?: string }>) =>
      repository.listLatest(input),
    /** A failed write rejects: the caller's event must fail rather than go unaudited. */
    async record(input: AuditInput, requestId: string | null): Promise<AuditRecord> {
      const record = buildAuditRecord(input, requestId, clock());
      await repository.insert(record);
      return record;
    },
  } as const;
}

export type AuditService = ReturnType<typeof createAuditService>;
