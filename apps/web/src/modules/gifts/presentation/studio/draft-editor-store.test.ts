import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDraftEditorStore,
  selectCanSaveNow,
  selectClientErrors,
  selectFieldErrors,
  selectFieldsDisabled,
  selectFirstInvalidField,
  selectIsDirty,
  selectShouldWarnOnLeave,
  selectStatusView,
  selectStepCompletion,
} from "./draft-editor-store";
import { DRAFT_MESSAGES } from "./draft-validation";
import { assetIds, draftGift, steppedManifest } from "./test/fixtures";

function createStore(content: Record<string, unknown> = {}, revision = 0) {
  return createDraftEditorStore({
    gift: draftGift(content, { revision }),
    manifest: steppedManifest,
    selectableTrackIds: ["acoustic-morning"],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDraftEditorStore", () => {
  it("creates independent stores", () => {
    const first = createStore();
    const second = createStore();

    first.getState().setFieldValue("receiver-name", "Linh");

    expect(first.getState().content).toEqual({ "receiver-name": "Linh" });
    expect(second.getState().content).toEqual({});
  });

  it("shows a rejected publish's field errors inline without changing the save status", () => {
    const store = createStore({ "receiver-name": "Linh" }, 3);

    store.getState().applyServerFieldErrors({
      "memories.2": "This image is not ready.",
      unknown: "Not a field.",
    });

    const state = store.getState();
    expect(state.serverFieldErrors).toEqual({ memories: DRAFT_MESSAGES.generic });
    expect(state.status).toBe("saved");
    expect(state.generalError).toBeNull();
  });

  it("starts saved with the loaded content and revision", () => {
    const store = createStore({ "receiver-name": "Linh" }, 3);
    const state = store.getState();

    expect(state.revision).toBe(3);
    expect(state.lastSavedContent).toBe(state.content);
    expect(selectIsDirty(state)).toBe(false);
    expect(selectStatusView(state)).toEqual({ kind: "saved", message: "Đã lưu" });
    expect(selectCanSaveNow(state)).toBe(false);
  });

  it("shows the invalid-content status for invalid loaded content without arming the warning", () => {
    const state = createStore({ audio: "old-piano" }).getState();

    expect(selectStatusView(state)).toEqual({
      fieldId: "audio",
      kind: "invalid",
      label: "Nhạc nền",
      message: "Chưa lưu được: Nhạc nền chưa hợp lệ",
    });
    expect(selectIsDirty(state)).toBe(false);
    expect(selectShouldWarnOnLeave(state)).toBe(false);
  });

  it("arms the warning for an edit that leaves the content invalid", () => {
    const store = createStore({ audio: "old-piano" });

    store.getState().setFieldValue("receiver-name", "Linh");

    expect(selectHasInvalid(store.getState())).toBe(true);
    expect(selectShouldWarnOnLeave(store.getState())).toBe(true);
    expect(selectCanSaveNow(store.getState())).toBe(false);
  });

  it("returns the first invalid field of the earliest step", () => {
    const state = createStore({ audio: "old-piano", "anniversary-date": "not-a-date" }).getState();

    expect(selectFirstInvalidField(state)).toEqual({
      fieldId: "anniversary-date",
      label: "Ngày kỷ niệm",
    });
    expect(selectFirstInvalidField(state)).toBe(selectFirstInvalidField(state));
  });

  it("normalizes values and clears only the edited field's server error", () => {
    const store = createStore({ "final-letter": "Thư", memories: [{ assetId: assetIds[0] }] });
    const sent = store.getState().content;
    store.getState().applyOutcome(
      {
        fieldErrors: { "final-letter": "Too long", "memories.0.caption": "Too long" },
        kind: "invalid",
      },
      sent,
    );
    expect(Object.keys(store.getState().serverFieldErrors)).toEqual(["final-letter", "memories"]);

    store.getState().setFieldValue("final-letter", "   ");

    expect(store.getState().content).toEqual({ memories: [{ assetId: assetIds[0] }] });
    expect(store.getState().serverFieldErrors).toEqual({ memories: DRAFT_MESSAGES.generic });
    expect(selectFieldErrors(store.getState())).toEqual({ memories: DRAFT_MESSAGES.generic });
    expect(selectFieldErrors(store.getState())).toBe(selectFieldErrors(store.getState()));
    expect(selectStatusView(store.getState())).toEqual({
      kind: "failed",
      message: "Chưa lưu được — thử lại",
    });
  });

  it("ignores edits of unknown fields", () => {
    const store = createStore();
    const before = store.getState();

    before.setFieldValue("unknown", "value");

    expect(store.getState().content).toBe(before.content);
  });

  it("does not mark fields changed while a rejected save was in flight", () => {
    const store = createStore({ memories: assetIds.map((assetId) => ({ assetId })) });
    const sent = store.getState().content;
    store.getState().beginSave();
    store.getState().setFieldValue("memories", [{ assetId: assetIds[0] }]);

    store
      .getState()
      .applyOutcome(
        { fieldErrors: { memories: "Not owned", content: "Unknown" }, kind: "invalid" },
        sent,
      );

    expect(store.getState().serverFieldErrors).toEqual({});
    expect(store.getState().generalError).toBe(DRAFT_MESSAGES.serverGeneral);
  });

  it("applies a saved outcome without replacing on-screen content", () => {
    const store = createStore({}, 3);
    store.getState().setFieldValue("receiver-name", "Linh ");
    const sent = store.getState().content;
    store.getState().beginSave();
    expect(selectStatusView(store.getState()).kind).toBe("saving");
    expect(selectShouldWarnOnLeave(store.getState())).toBe(true);

    store.getState().setFieldValue("receiver-name", "Linh ơi");
    store
      .getState()
      .applyOutcome(
        { gift: draftGift({ "receiver-name": "Linh" }, { revision: 4 }), kind: "saved" },
        sent,
      );

    const state = store.getState();
    expect(state.revision).toBe(4);
    expect(state.content).toEqual({ "receiver-name": "Linh ơi" });
    expect(state.lastSavedContent).toBe(sent);
    expect(state.status).toBe("pending");
    expect(selectStatusView(state).kind).toBe("saving");
  });

  it("records conflicts, gone drafts and failures", () => {
    const store = createStore();
    store.getState().setFieldValue("receiver-name", "Linh");
    const sent = store.getState().content;

    store.getState().applyOutcome({ actualRevision: 5, kind: "conflict" }, sent);
    expect(store.getState().conflict).toEqual({ actualRevision: 5 });
    expect(selectStatusView(store.getState())).toEqual({ kind: "hidden" });
    expect(selectShouldWarnOnLeave(store.getState())).toBe(true);
    expect(selectCanSaveNow(store.getState())).toBe(false);

    store.getState().applyOutcome({ kind: "transient" }, sent);
    expect(selectStatusView(store.getState()).kind).toBe("failed");
    store.getState().applyOutcome({ kind: "offline" }, sent);
    expect(selectStatusView(store.getState()).kind).toBe("offline");

    store.getState().applyOutcome({ kind: "gone" }, sent);
    expect(store.getState()).toMatchObject({ conflict: null, readOnly: true });
    expect(selectStatusView(store.getState())).toEqual({ kind: "hidden" });
    expect(selectCanSaveNow(store.getState())).toBe(false);
    // Nothing can be saved any more: no leave warning, and fields stay read-only.
    expect(selectShouldWarnOnLeave(store.getState())).toBe(false);
    expect(selectFieldsDisabled(store.getState())).toBe(true);
    store.getState().setFieldValue("receiver-name", "Changed");
    expect(store.getState().content).toBe(sent);
  });

  it("ignores edits while a publish request runs and accepts them again afterwards", () => {
    const store = createStore({ "receiver-name": "Linh" });
    const before = store.getState().content;
    const listener = vi.fn();
    store.subscribe(listener);

    store.getState().setPublishing(true);
    expect(selectFieldsDisabled(store.getState())).toBe(true);
    listener.mockClear();
    store.getState().setFieldValue("receiver-name", "Typed while publishing");
    expect(store.getState().content).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    store.getState().setPublishing(false);
    expect(selectFieldsDisabled(store.getState())).toBe(false);
    store.getState().setFieldValue("receiver-name", "Lan");
    expect(store.getState().content).toEqual({ "receiver-name": "Lan" });
  });

  it("does not notify subscribers for a change that changes nothing", () => {
    const store = createStore({ "receiver-name": "Linh" });
    const listener = vi.fn();
    store.subscribe(listener);

    store.getState().setFieldValue("receiver-name", "Linh");

    expect(listener).not.toHaveBeenCalled();
  });

  it("replaces everything from the stored draft and bumps the content generation", () => {
    const store = createStore();
    store.getState().setFieldValue("receiver-name", "Tab B");
    store
      .getState()
      .applyOutcome({ actualRevision: 6, kind: "conflict" }, store.getState().content);
    store.getState().setReloadError(true);

    store.getState().replaceFromServer(draftGift({ "receiver-name": "Tab A" }, { revision: 6 }));

    const state = store.getState();
    expect(state).toMatchObject({
      conflict: null,
      content: { "receiver-name": "Tab A" },
      contentGeneration: 1,
      reloadError: false,
      revision: 6,
      serverFieldErrors: {},
      status: "saved",
    });
    expect(selectStatusView(state)).toEqual({ kind: "saved", message: "Đã lưu" });
  });

  it("tracks the offline state only while something is unsaved", () => {
    const store = createStore();
    store.getState().setOffline(true);
    expect(store.getState().status).toBe("saved");

    store.getState().setFieldValue("receiver-name", "Linh");
    store.getState().setOffline(true);
    expect(selectStatusView(store.getState())).toEqual({
      kind: "offline",
      message: "Mất kết nối — sẽ lưu khi có mạng",
    });
    store.getState().setOffline(false);
    expect(store.getState().status).toBe("pending");

    store.getState().setStatus("offline");
    store.getState().setFieldValue("receiver-name", undefined);
    store.getState().setOffline(false);
    expect(store.getState().status).toBe("saved");
  });

  it("computes completion per template step from the full rules", () => {
    const store = createStore({ memories: [{ assetId: assetIds[0] }], "receiver-name": "Linh" });

    expect(selectStepCompletion(store.getState())).toEqual({
      letter: false,
      memories: false,
      opening: false,
      recipient: true,
      style: true,
    });
    expect(selectStepCompletion(store.getState())).toBe(selectStepCompletion(store.getState()));
  });

  it("memoizes client errors per content", () => {
    const store = createStore({ audio: "old-piano" });
    const errors = selectClientErrors(store.getState());
    store.getState().setStatus("pending");

    expect(selectClientErrors(store.getState())).toBe(errors);
  });

  it("never writes to localStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const store = createStore();

    store.getState().setFieldValue("final-letter", "Anh nhớ em");
    store.getState().beginSave();
    store.getState().applyOutcome({ gift: draftGift({}, { revision: 1 }), kind: "saved" }, {});

    expect(setItem).not.toHaveBeenCalled();
  });
});

function selectHasInvalid(state: Parameters<typeof selectFirstInvalidField>[0]): boolean {
  return selectFirstInvalidField(state) !== null;
}
