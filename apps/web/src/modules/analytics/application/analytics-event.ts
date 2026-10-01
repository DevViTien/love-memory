import { type AnalyticsEventName, type AnalyticsEventRequest } from "@love-memory/contracts";

/** Events expire this many days after they were accepted (TTL index on `expiresAt`). */
export const ANALYTICS_RETENTION_DAYS = 180;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * The one stored shape of a funnel event: exactly nine keys, none optional, so every document has
 * the same fields and the validator can require all of them. No content, identifier of a person or
 * share link, client time or request metadata has a place in it.
 */
export type AnalyticsEventRecord = Readonly<{
  _id: string;
  expiresAt: Date;
  giftRef: string;
  name: AnalyticsEventName;
  occurredAt: Date;
  sceneId: string | null;
  sessionId: string | null;
  templateId: string;
  templateVersion: string;
}>;

/** The server-only publish event: no browser session. */
export type GiftPublishedEvent = Readonly<{
  giftRef: string;
  name: "gift_published";
  templateId: string;
  templateVersion: string;
}>;

/**
 * Builds the stored record from a validated browser request or the server publish event. The
 * server sets `occurredAt`; `expiresAt` is exactly 180 days later.
 */
export function createAnalyticsEventRecord(
  event: AnalyticsEventRequest | GiftPublishedEvent,
  id: string,
  now: Date,
): AnalyticsEventRecord {
  const isBrowserEvent = event.name !== "gift_published";
  return {
    _id: id,
    expiresAt: new Date(now.getTime() + ANALYTICS_RETENTION_DAYS * DAY_MILLISECONDS),
    giftRef: event.giftRef,
    name: event.name,
    occurredAt: now,
    sceneId: event.name === "scene_completed" ? (event.sceneId ?? null) : null,
    sessionId: isBrowserEvent ? event.sessionId : null,
    templateId: event.templateId,
    templateVersion: event.templateVersion,
  };
}
