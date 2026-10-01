import { describe, expect, it, vi } from "vitest";

import {
  createDraftEditorStore,
  type DraftEditorStore,
  selectIsDirty,
  selectTemplateStepsComplete,
} from "@/modules/gifts/presentation/studio/draft-editor-store";
import {
  assetIds,
  draftGift,
  steppedManifest,
} from "@/modules/gifts/presentation/studio/test/fixtures";

import { type AnalyticsClient } from "./analytics-client";
import { trackStudioFunnel } from "./studio-funnel";

const complete = {
  "final-letter": "Gửi em",
  memories: assetIds.map((assetId) => ({ assetId })),
  "opening-message": "Mở hộp nhé",
  "receiver-name": "Minh Thư",
};

function createStore(content: Record<string, unknown> = {}, revision = 0): DraftEditorStore {
  return createDraftEditorStore({
    gift: draftGift(content, { revision }),
    manifest: steppedManifest,
    selectableTrackIds: ["acoustic-morning"],
  });
}

/** A fake client with the real `sendOnce` contract: once per name for this tab's storage. */
function fakeClient(sentOnce = new Set<string>()) {
  const sent: string[] = [];
  const client: AnalyticsClient = {
    send: vi.fn((name: string) => void sent.push(name)),
    sendOnce: vi.fn((name: string) => {
      if (sentOnce.has(name)) return;
      sentOnce.add(name);
      sent.push(name);
    }),
  };
  return { client, sent, sentOnce };
}

function track(store: DraftEditorStore, client: AnalyticsClient) {
  return trackStudioFunnel({
    client,
    isComplete: selectTemplateStepsComplete,
    isDirty: selectIsDirty,
    store,
  });
}

/** One autosave of the content on screen: `saving`, then the server's `200`. */
function save(store: DraftEditorStore) {
  const state = store.getState();
  const sent = state.content;
  state.beginSave();
  store
    .getState()
    .applyOutcome(
      { gift: draftGift(sent, { revision: store.getState().revision + 1 }), kind: "saved" },
      sent,
    );
}

describe("Studio funnel tracker", () => {
  it("sends customization_started once for the first successful save (First autosave)", () => {
    const store = createStore();
    const { client, sent, sentOnce } = fakeClient();
    track(store, client);

    store.getState().setFieldValue("receiver-name", "Minh");
    expect(sent).toEqual([]);
    save(store);
    store.getState().setFieldValue("receiver-name", "Minh Thư");
    save(store);
    expect(sent).toEqual(["customization_started"]);

    // A reload in the same tab: a new store and tracker, the same tab storage.
    const reloaded = createStore({ "receiver-name": "Minh Thư" }, 2);
    const again = fakeClient(sentOnce);
    track(reloaded, again.client);
    reloaded.getState().setFieldValue("receiver-name", "Thư");
    save(reloaded);
    expect(again.sent).toEqual([]);
  });

  it("sends required_content_completed once when a save completes every step (Last required field saved)", () => {
    const { memories: _memories, ...withoutPhotos } = complete;
    const store = createStore({ ...withoutPhotos, memories: complete.memories.slice(0, 2) }, 4);
    const { client, sent } = fakeClient();
    track(store, client);

    store.getState().setFieldValue("memories", complete.memories);
    // Complete on screen, but not saved yet.
    expect(sent).toEqual([]);
    save(store);
    expect(sent).toEqual(["customization_started", "required_content_completed"]);

    store.getState().setFieldValue("receiver-name", "Thư");
    save(store);
    expect(sent).toEqual(["customization_started", "required_content_completed"]);
  });

  it("sends nothing when an edit is undone within the debounce (no save happens)", () => {
    const store = createStore(complete, 9);
    const { client, sent } = fakeClient();
    track(store, client);

    // Clear and retype: incomplete on screen, then equal to the saved content again. The autosave
    // controller marks it "saved" without sending anything.
    store.getState().setFieldValue("receiver-name", "");
    store.getState().setFieldValue("receiver-name", complete["receiver-name"]);
    store.getState().setStatus("saved");

    expect(sent).toEqual([]);
  });

  it("sends nothing when a conflict reload brings complete content", () => {
    const { memories: _memories, ...withoutPhotos } = complete;
    const store = createStore({ ...withoutPhotos, memories: complete.memories.slice(0, 2) }, 4);
    const { client, sent } = fakeClient();
    track(store, client);

    store.getState().replaceFromServer(draftGift(complete, { revision: 7 }));

    expect(sent).toEqual([]);
  });

  it("sends required_content_completed exactly once for the real save that completes the draft", () => {
    const store = createStore(complete, 9);
    const { client, sent } = fakeClient();
    track(store, client);

    store.getState().setFieldValue("receiver-name", "");
    save(store);
    store.getState().setFieldValue("receiver-name", "Thư");
    save(store);
    store.getState().setFieldValue("receiver-name", "Minh Thư");
    save(store);

    expect(sent).toEqual(["customization_started", "required_content_completed"]);
  });

  it("never sends required_content_completed for a draft complete when opened", () => {
    const store = createStore(complete, 9);
    const { client, sent } = fakeClient();
    track(store, client);

    store
      .getState()
      .setFieldValue("memories", [
        { assetId: assetIds[0], caption: "Đà Lạt" },
        ...complete.memories.slice(1),
      ]);
    save(store);
    expect(sent).toEqual(["customization_started"]);
  });

  it("sends nothing until a save succeeds (Failed save)", () => {
    const store = createStore();
    const { client, sent } = fakeClient();
    track(store, client);

    store.getState().setFieldValue("receiver-name", "Minh");
    const sentContent = store.getState().content;
    store.getState().beginSave();
    store.getState().applyOutcome({ kind: "offline" }, sentContent);
    store.getState().setOffline(false);
    expect(sent).toEqual([]);

    save(store);
    expect(sent).toEqual(["customization_started"]);
  });

  it("does not count a conflict reload as a creator edit", () => {
    const store = createStore({ "receiver-name": "Minh" }, 1);
    const { client, sent } = fakeClient();
    track(store, client);

    store.getState().replaceFromServer(draftGift(complete, { revision: 5 }));
    expect(sent).not.toContain("customization_started");
  });

  it("stops every event once unsubscribed", () => {
    const store = createStore();
    const { client, sent } = fakeClient();
    const unsubscribe = track(store, client);
    unsubscribe();

    store.getState().setFieldValue("receiver-name", "Minh");
    save(store);
    expect(sent).toEqual([]);
    expect(client.sendOnce).not.toHaveBeenCalled();
  });
});
