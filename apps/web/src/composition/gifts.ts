import { randomBytes, randomUUID } from "node:crypto";

import { createGiftService } from "@/modules/gifts/application/gift-service";
import { createAnonymousDraftIdentity } from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import { mongoGiftTemplateRepository } from "@/modules/gifts/infrastructure/mongo-gift-template-repository";

export const giftService = createGiftService({
  clock: () => new Date(),
  createAnonymousIdentity: createAnonymousDraftIdentity,
  createId: randomUUID,
  createPublicId: () => randomBytes(18).toString("base64url"),
  gifts: mongoGiftRepository,
  templates: mongoGiftTemplateRepository,
});

export function getGiftTemplateManifest(templateId: string, version: string) {
  return mongoGiftTemplateRepository.findPublishedManifest(templateId, version);
}
