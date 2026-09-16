import { createGiftDraft, type Gift, updateGiftDraft } from "@love-memory/domain";
import { parseTemplateDraftPayload, type TemplateManifest } from "@love-memory/template-sdk";
import { z } from "zod";

export type GiftAccessor =
  | Readonly<{ isAdmin: boolean; kind: "user"; userId: string }>
  | Readonly<{ anonymousDraftId: string; claimTokenHash: string; kind: "anonymous" }>;

export type AnonymousDraftIdentity = Readonly<{
  anonymousDraftId: string;
  claimToken: string;
  claimTokenHash: string;
}>;

export interface GiftRepository {
  claimDraft(
    publicId: string,
    ownerId: string,
    anonymousDraftId: string,
    claimTokenHash: string,
    now: Date,
  ): Promise<Gift | null>;
  createDraft(gift: Gift): Promise<void>;
  findAuthorized(publicId: string, accessor: GiftAccessor): Promise<Gift | null>;
  findByPublicId(publicId: string): Promise<Gift | null>;
  updateDraft(gift: Gift, expectedRevision: number, accessor: GiftAccessor): Promise<Gift | null>;
}

export interface GiftTemplateRepository {
  findPublishedManifest(templateId: string, version: string): Promise<TemplateManifest | null>;
}

export type GiftServiceError = Readonly<
  | { code: "NOT_FOUND" }
  | { code: "NOT_AUTHENTICATED" }
  | { code: "INVALID_CONTENT"; fieldErrors: Readonly<Record<string, string>> }
  | { code: "INVALID_STATE" }
  | { actualRevision: number; code: "REVISION_CONFLICT"; expectedRevision: number }
>;

export type GiftServiceResult<T> =
  Readonly<{ data: T; ok: true }> | Readonly<{ error: GiftServiceError; ok: false }>;

export type GiftDraftDto = Readonly<{
  content: Readonly<Record<string, unknown>>;
  createdAt: string;
  ownerKind: "anonymous" | "user";
  publicId: string;
  revision: number;
  status: "draft";
  templateId: string;
  templateVersion: string;
  updatedAt: string;
}>;

export type GiftServiceDependencies = Readonly<{
  clock: () => Date;
  createAnonymousIdentity: () => AnonymousDraftIdentity;
  createId: () => string;
  createPublicId: () => string;
  gifts: GiftRepository;
  templates: GiftTemplateRepository;
}>;

function success<T>(data: T): GiftServiceResult<T> {
  return { data, ok: true };
}

function failure(error: GiftServiceError): GiftServiceResult<never> {
  return { error, ok: false };
}

function toDto(gift: Gift): GiftDraftDto {
  if (gift.status !== "draft") {
    throw new Error("Only draft gifts can be represented by GiftDraftDto.");
  }

  return {
    content: gift.content.data,
    createdAt: gift.createdAt.toISOString(),
    ownerKind: gift.ownership.ownerId === null ? "anonymous" : "user",
    publicId: gift.publicId,
    revision: gift.revision,
    status: gift.status,
    templateId: gift.content.templateId,
    templateVersion: gift.content.templateVersion,
    updatedAt: gift.updatedAt.toISOString(),
  };
}

function toFieldErrors(error: z.ZodError): Readonly<Record<string, string>> {
  return Object.fromEntries(
    error.issues.map((issue) => [issue.path.join(".") || "content", issue.message]),
  );
}

export function createGiftService(dependencies: GiftServiceDependencies) {
  return {
    async claimDraft(
      input: Readonly<{
        anonymousDraftId: string | null;
        claimTokenHash: string | null;
        publicId: string;
        userId: string | null;
      }>,
    ): Promise<GiftServiceResult<GiftDraftDto>> {
      if (!input.userId) {
        return failure({ code: "NOT_AUTHENTICATED" });
      }

      if (!input.anonymousDraftId || !input.claimTokenHash) {
        return failure({ code: "NOT_FOUND" });
      }

      const claimed = await dependencies.gifts.claimDraft(
        input.publicId,
        input.userId,
        input.anonymousDraftId,
        input.claimTokenHash,
        dependencies.clock(),
      );

      return claimed ? success(toDto(claimed)) : failure({ code: "NOT_FOUND" });
    },

    async createDraft(
      input: Readonly<{
        anonymousIdentity?: AnonymousDraftIdentity;
        ownerId: string | null;
        templateId: string;
        templateVersion: string;
      }>,
    ): Promise<
      GiftServiceResult<
        Readonly<{ anonymousIdentity: AnonymousDraftIdentity | null; gift: GiftDraftDto }>
      >
    > {
      const manifest = await dependencies.templates.findPublishedManifest(
        input.templateId,
        input.templateVersion,
      );
      if (!manifest) {
        return failure({ code: "NOT_FOUND" });
      }

      const anonymousIdentity = input.ownerId
        ? null
        : (input.anonymousIdentity ?? dependencies.createAnonymousIdentity());
      const draft = createGiftDraft({
        anonymousDraftId: anonymousIdentity?.anonymousDraftId ?? null,
        claimTokenHash: anonymousIdentity?.claimTokenHash ?? null,
        content: {
          data: {},
          schemaVersion: 1,
          templateId: manifest.id,
          templateVersion: manifest.version,
        },
        id: dependencies.createId(),
        now: dependencies.clock(),
        ownerId: input.ownerId,
        publicId: dependencies.createPublicId(),
      });

      await dependencies.gifts.createDraft(draft);
      return success({ anonymousIdentity, gift: toDto(draft) });
    },

    async getDraft(
      input: Readonly<{
        accessor: GiftAccessor;
        publicId: string;
      }>,
    ): Promise<GiftServiceResult<GiftDraftDto>> {
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessor);
      return gift?.status === "draft" ? success(toDto(gift)) : failure({ code: "NOT_FOUND" });
    },

    async updateDraft(
      input: Readonly<{
        accessor: GiftAccessor;
        content: Readonly<Record<string, unknown>>;
        expectedRevision: number;
        publicId: string;
      }>,
    ): Promise<GiftServiceResult<GiftDraftDto>> {
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessor);
      if (!gift) {
        return failure({ code: "NOT_FOUND" });
      }

      const manifest = await dependencies.templates.findPublishedManifest(
        gift.content.templateId,
        gift.content.templateVersion,
      );
      if (!manifest) {
        return failure({ code: "INVALID_STATE" });
      }

      let content: Readonly<Record<string, unknown>>;
      try {
        content = parseTemplateDraftPayload(manifest, input.content);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return failure({ code: "INVALID_CONTENT", fieldErrors: toFieldErrors(error) });
        }
        throw error;
      }
      const updated = updateGiftDraft(gift, {
        content: { ...gift.content, data: content },
        expectedRevision: input.expectedRevision,
        now: dependencies.clock(),
      });

      if (!updated.ok) {
        if (updated.error.code === "GIFT_REVISION_CONFLICT") {
          return failure({
            actualRevision: updated.error.actualRevision,
            code: "REVISION_CONFLICT",
            expectedRevision: updated.error.expectedRevision,
          });
        }
        return failure({ code: "INVALID_STATE" });
      }

      const persisted = await dependencies.gifts.updateDraft(
        updated.data,
        input.expectedRevision,
        input.accessor,
      );
      if (persisted) {
        return success(toDto(persisted));
      }

      const current = await dependencies.gifts.findByPublicId(input.publicId);
      return current
        ? failure({
            actualRevision: current.revision,
            code: "REVISION_CONFLICT",
            expectedRevision: input.expectedRevision,
          })
        : failure({ code: "NOT_FOUND" });
    },
  } as const;
}
