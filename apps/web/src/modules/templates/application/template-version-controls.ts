import { z } from "zod";

export const TEMPLATE_KILL_REASONS = ["broken", "security", "legal", "other"] as const;
export type TemplateKillReason = (typeof TEMPLATE_KILL_REASONS)[number];

/** `POST /api/admin/template-versions`: `reason` is required for `kill` and refused otherwise. */
export const TemplateVersionActionRequestSchema = z
  .object({
    action: z.enum(["retire", "kill", "restore"]),
    reason: z.enum(TEMPLATE_KILL_REASONS).optional(),
    templateId: z.string().min(1).max(64),
    version: z.string().min(1).max(32),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.action === "kill" && request.reason === undefined) {
      context.addIssue({ code: "custom", message: "A kill needs a reason.", path: ["reason"] });
    }
    if (request.action !== "kill" && request.reason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a kill takes a reason.",
        path: ["reason"],
      });
    }
  });

export type TemplateVersionActionRequest = z.output<typeof TemplateVersionActionRequestSchema>;

/** One stored template version as the admin area sees it (`template-version-controls`). */
export type TemplateVersionState = Readonly<{
  current: boolean;
  killReason: TemplateKillReason | null;
  killed: boolean;
  status: "draft" | "published" | "retired";
  templateId: string;
  version: string;
}>;

export type TemplateVersionTransition = Readonly<{
  action: TemplateVersionActionRequest["action"];
  actorId: string;
  now: Date;
  reason?: TemplateKillReason;
  requestId: string | null;
  templateId: string;
  version: string;
}>;

export interface TemplateVersionStateRepository {
  findState(templateId: string, version: string): Promise<TemplateVersionState | null>;
  /** Whether the version is killed: its artifact must not be used anywhere. */
  isKilled(templateId: string, version: string): Promise<boolean>;
  listVersions(): Promise<readonly TemplateVersionState[]>;
  /**
   * Applies the transition with its audit record in one transaction, only when it changes the
   * version. `false` means nothing matched and nothing was written.
   */
  transition(input: TemplateVersionTransition): Promise<boolean>;
}

export type TemplateVersionActionResult =
  | Readonly<{ changed: boolean; kind: "ok"; version: TemplateVersionState }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "not-released" }>;

/** The admin retire, kill and restore actions of `template-version-controls`. */
export function createTemplateVersionControls({
  clock = () => new Date(),
  repository,
}: Readonly<{ clock?: () => Date; repository: TemplateVersionStateRepository }>) {
  async function apply(
    request: TemplateVersionActionRequest,
    actor: Readonly<{ id: string; requestId: string | null }>,
  ): Promise<TemplateVersionActionResult> {
    const changed = await repository.transition({
      action: request.action,
      actorId: actor.id,
      now: clock(),
      ...(request.reason ? { reason: request.reason } : {}),
      requestId: actor.requestId,
      templateId: request.templateId,
      version: request.version,
    });
    const state = await repository.findState(request.templateId, request.version);
    if (!state) return { kind: "not-found" };
    if (!changed && state.status === "draft") return { kind: "not-released" };
    return { changed, kind: "ok", version: state };
  }

  return { apply, listVersions: () => repository.listVersions() } as const;
}

export type TemplateVersionControls = ReturnType<typeof createTemplateVersionControls>;
