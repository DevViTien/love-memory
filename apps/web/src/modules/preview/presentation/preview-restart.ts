import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";

/**
 * A restart reuses the held signed URLs only while they stay valid this long: the handshake budget
 * (15 s load + 20 × 250 ms) plus the first scenes, so no photo is requested with an expired URL.
 */
export const RESTART_URL_MARGIN_MS = 60_000;

/** `client`: remount with the held payload. `server`: re-read the draft and sign fresh URLs. */
export type PreviewRestartMode = "client" | "server";

/** The preview controls that restart the gift. */
export type PreviewRestartAction = "reduced-motion" | "restart";

export function chooseRestartMode(
  viewer: Pick<ViewerPayload, "assetsExpireAt">,
  nowMs: number,
): PreviewRestartMode {
  if (viewer.assetsExpireAt === null) return "client";
  const expiresAt = Date.parse(viewer.assetsExpireAt);
  // An unreadable expiry is treated as expired: the server signs fresh URLs.
  if (Number.isNaN(expiresAt)) return "server";
  return expiresAt - nowMs > RESTART_URL_MARGIN_MS ? "client" : "server";
}
