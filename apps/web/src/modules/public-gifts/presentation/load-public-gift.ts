import { PublicGiftResponseSchema } from "@love-memory/contracts";

import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";

/**
 * The deferred source of the public gift viewer: fetched only after the recipient's `Mở quà`
 * gesture (and again for fresh asset URLs), without credentials and without any cache. Any
 * failure throws, so the gift viewer shows its retry message and no content.
 */
export async function loadPublicGift(
  fetchImpl: typeof fetch,
  shareId: string,
): Promise<ViewerPayload> {
  const response = await fetchImpl(`/api/public-gifts/${encodeURIComponent(shareId)}`, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (response.status !== 200) {
    throw new Error(`The public gift could not be loaded (${response.status}).`);
  }
  const parsed = PublicGiftResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("The public gift response is invalid.");
  }
  return parsed.data.data.viewer;
}
