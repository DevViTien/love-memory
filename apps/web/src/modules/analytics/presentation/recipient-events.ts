import { AnalyticsSceneIdSchema } from "@love-memory/contracts";

import { type AnalyticsClient } from "./analytics-client";

/** The gift viewer's lifecycle notifications; payloads never carry content. */
export type RecipientLifecycleEvent =
  | Readonly<{ reason: string; type: "fallback" }>
  | Readonly<{ sceneId: string; type: "scene" }>
  | Readonly<{ type: "completed" }>
  | Readonly<{ type: "opened" }>;

/**
 * Turns the public page's viewer notifications into recipient events (`funnel-analytics`
 * "Recipient events on the public gift page"), once per page load:
 *
 * - `opened` → `gift_open_interaction`, once;
 * - `scene` → `scene_completed` for the scene before it, then it becomes the current scene;
 * - `completed` → `scene_completed` for the current scene if not yet sent, then `gift_completed`;
 * - `fallback` → nothing, and no `scene_completed` or `gift_completed` after it.
 *
 * Each scene id is sent at most once, an id that is not a kebab-case slug is skipped, and `scene`
 * or `completed` before `opened` is ignored.
 */
export function createRecipientEventReporter(
  client: AnalyticsClient,
): (event: RecipientLifecycleEvent) => void {
  let opened = false;
  let ended = false;
  let currentScene: string | null = null;
  const sentScenes = new Set<string>();

  function completeCurrentScene() {
    if (currentScene === null || sentScenes.has(currentScene)) return;
    sentScenes.add(currentScene);
    client.send("scene_completed", currentScene);
  }

  return (event) => {
    switch (event.type) {
      case "opened":
        if (opened) return;
        opened = true;
        client.send("gift_open_interaction");
        return;
      case "scene":
        // Nothing before `Mở quà` delivered the content.
        if (ended || !opened) return;
        // A repeated notice of the current scene is not the next scene starting.
        if (event.sceneId === currentScene) return;
        completeCurrentScene();
        currentScene = AnalyticsSceneIdSchema.safeParse(event.sceneId).success
          ? event.sceneId
          : null;
        return;
      case "completed":
        if (ended || !opened) return;
        completeCurrentScene();
        client.send("gift_completed");
        ended = true;
        return;
      case "fallback":
        ended = true;
        return;
    }
  };
}
