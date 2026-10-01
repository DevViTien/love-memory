import { SemanticVersionSchema, SlugSchema } from "@love-memory/shared";
import { z } from "zod";

/** Every funnel event the system records (`funnel-analytics` "Event taxonomy and stored record"). */
export const ANALYTICS_EVENT_NAMES = [
  "customization_started",
  "required_content_completed",
  "preview_started",
  "publish_clicked",
  "gift_published",
  "gift_open_interaction",
  "scene_completed",
  "gift_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/** The events a browser may send: every name except the server-only `gift_published`. */
export const CLIENT_ANALYTICS_EVENT_NAMES = [
  "customization_started",
  "required_content_completed",
  "preview_started",
  "publish_clicked",
  "gift_open_interaction",
  "scene_completed",
  "gift_completed",
] as const satisfies readonly AnalyticsEventName[];

export type ClientAnalyticsEventName = (typeof CLIENT_ANALYTICS_EVENT_NAMES)[number];

/** The unpadded base64url HMAC-SHA-256 of a gift id: 32 bytes are 43 characters. */
export const GiftRefSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, {
  message: "Expected a 43-character gift reference.",
});

/** Stricter than the SDK's `SCENE` id on purpose: a scene id can never carry free text. */
export const AnalyticsSceneIdSchema = SlugSchema;

const TemplateVersionSchema = SemanticVersionSchema.max(64);

/**
 * One browser event. The exact key set fails closed: no gift text, share id, URL or client time
 * can be added. `sceneId` is required for `scene_completed` and forbidden otherwise.
 */
export const AnalyticsEventRequestSchema = z
  .object({
    giftRef: GiftRefSchema,
    name: z.enum(CLIENT_ANALYTICS_EVENT_NAMES),
    sceneId: AnalyticsSceneIdSchema.exactOptional(),
    sessionId: z.uuid(),
    templateId: SlugSchema,
    templateVersion: TemplateVersionSchema,
  })
  .strict()
  .superRefine((event, context) => {
    const isScene = event.name === "scene_completed";
    if (isScene && event.sceneId === undefined) {
      context.addIssue({
        code: "custom",
        message: "A scene_completed event requires a sceneId.",
        path: ["sceneId"],
      });
    }
    if (!isScene && event.sceneId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a scene_completed event carries a sceneId.",
        path: ["sceneId"],
      });
    }
  });

export type AnalyticsEventRequest = z.output<typeof AnalyticsEventRequestSchema>;

/** What a page hands its client components; it is not gift content. */
export const AnalyticsContextSchema = z
  .object({
    giftRef: GiftRefSchema,
    templateId: SlugSchema,
    templateVersion: TemplateVersionSchema,
  })
  .strict();

export type AnalyticsContext = z.output<typeof AnalyticsContextSchema>;
