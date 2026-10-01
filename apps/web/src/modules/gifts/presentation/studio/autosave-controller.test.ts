import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosaveController } from "./autosave-controller";
import { createDraftEditorStore, selectStatusView } from "./draft-editor-store";
import { type DraftContent } from "./draft-validation";
import { type DraftRequestOptions, type LoadOutcome, type SaveOutcome } from "./save-draft-request";
import { assetIds, draftGift, steppedManifest } from "./test/fixtures";

type SaveCall = Readonly<{
  content: DraftContent;
  expectedRevision: number;
  options: DraftRequestOptions;
  resolve: (outcome: SaveOutcome) => void;
}>;

function setup(content: Record<string, unknown> = {}, revision = 0) {
  const store = createDraftEditorStore({
    gift: draftGift(content, { revision }),
    manifest: steppedManifest,
    selectableTrackIds: ["acoustic-morning"],
  });
  const calls: SaveCall[] = [];
  const saveDraft = vi.fn(
    (
      _publicId: string,
      sent: DraftContent,
      expectedRevision: number,
      options: DraftRequestOptions,
    ) =>
      new Promise<SaveOutcome>((resolve) => {
        calls.push({ content: sent, expectedRevision, options, resolve });
      }),
  );
  const loadDraft = vi.fn<(publicId: string) => Promise<LoadOutcome>>();
  const network = { online: true };
  const controller = createAutosaveController({
    isOnline: () => network.online,
    loadDraft,
    saveDraft,
    store,
  });
  controller.start();

  async function resolve(index: number, outcome: SaveOutcome) {
    calls[index]!.resolve(outcome);
    await vi.advanceTimersByTimeAsync(0);
  }

  return {
    calls,
    controller,
    edit: (fieldId: string, value: unknown) => store.getState().setFieldValue(fieldId, value),
    loadDraft,
    network,
    resolve,
    status: () => selectStatusView(store.getState()),
    store,
  };
}

function saved(revision: number, content: Record<string, unknown> = {}): SaveOutcome {
  return { gift: draftGift(content, { revision }), kind: "saved" };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("debounced single-flight autosave", () => {
  it("sends one save after a typing burst", async () => {
    const { calls, edit, status } = setup();
    let text = "";
    for (const character of "Người thươ") {
      text += character;
      edit("receiver-name", text);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(status().kind).toBe("saving");

    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.content).toEqual({ "receiver-name": "Người thươ" });
    expect(calls[0]?.expectedRevision).toBe(0);
  });

  it("sends changes made during a save next, with the new revision", async () => {
    const { calls, edit, resolve } = setup({}, 3);
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    edit("opening-message", "Mở");
    edit("opening-message", "Mở hộp");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(1);

    await resolve(0, saved(4));

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      content: { "opening-message": "Mở hộp", "receiver-name": "Linh" },
      expectedRevision: 4,
    });
  });

  it("waits for the delay again when typing continues after a save", async () => {
    const { calls, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    edit("receiver-name", "Linh ơi");
    await resolve(0, saved(1));
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[1]?.expectedRevision).toBe(1);
  });

  it("does not send unchanged content", async () => {
    const { calls, edit, status } = setup({ "receiver-name": "Linh" });
    edit("receiver-name", "Linhh");
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(5000);

    expect(calls).toHaveLength(0);
    expect(status()).toEqual({ kind: "saved", message: "Đã lưu" });
  });

  it("keeps typing done during a save", async () => {
    const { calls, edit, resolve, status, store } = setup();
    edit("receiver-name", "Linh ");
    await vi.advanceTimersByTimeAsync(1500);
    edit("receiver-name", "Linh ơi");

    await resolve(0, saved(1, { "receiver-name": "Linh" }));

    expect(store.getState().content).toEqual({ "receiver-name": "Linh ơi" });
    expect(status().kind).toBe("saving");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(1, saved(2));
    expect(calls[1]?.content).toEqual({ "receiver-name": "Linh ơi" });
    expect(status().kind).toBe("saved");
  });

  it("never sends content with a client-side error", async () => {
    const { calls, controller, edit, status } = setup({ audio: "old-piano" });
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(5000);
    controller.saveNow();

    expect(calls).toHaveLength(0);
    expect(status()).toMatchObject({ fieldId: "audio", kind: "invalid" });

    edit("audio", "");
    expect(status().kind).toBe("saving");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[0]?.content).toEqual({ "receiver-name": "Linh" });
  });
});

describe("manual save", () => {
  it("saves immediately and not again when the delay would have ended", async () => {
    const { calls, controller, edit, resolve, status } = setup();
    edit("receiver-name", "Linh");
    controller.saveNow();
    expect(calls).toHaveLength(1);

    await resolve(0, saved(1));
    await vi.advanceTimersByTimeAsync(2000);

    expect(calls).toHaveLength(1);
    expect(status().kind).toBe("saved");
  });

  it("queues behind a request in flight and does nothing when saved", async () => {
    const { calls, controller, edit, resolve } = setup();
    controller.saveNow();
    expect(calls).toHaveLength(0);

    edit("receiver-name", "Linh");
    controller.saveNow();
    edit("receiver-name", "Linh ơi");
    controller.saveNow();
    expect(calls).toHaveLength(1);

    await resolve(0, saved(1));
    expect(calls[1]?.content).toEqual({ "receiver-name": "Linh ơi" });
  });
});

describe("failures, retries and offline", () => {
  it("retries a temporary server error", async () => {
    const { calls, edit, resolve, status } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "transient" });
    expect(status()).toEqual({ kind: "failed", message: "Chưa lưu được — thử lại" });

    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await resolve(1, saved(1));

    expect(status().kind).toBe("saved");
  });

  it("waits for retryAfterSeconds after a rate limit", async () => {
    const { calls, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "rate-limited", retryAfterSeconds: 20 });

    edit("receiver-name", "Linh ơi");
    await vi.advanceTimersByTimeAsync(18_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.content).toEqual({ "receiver-name": "Linh ơi" });
  });

  it("still sends the latest content when a flush runs inside a rate-limit window (Dependent action during a rate-limit window)", async () => {
    const { calls, controller, edit, resolve, status } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "rate-limited", retryAfterSeconds: 20 });

    edit("receiver-name", "Linh ơi");
    await vi.advanceTimersByTimeAsync(500);
    await expect(controller.flush({ keepalive: true })).resolves.toEqual({ kind: "failed" });
    expect(status().kind).toBe("failed");
    await vi.advanceTimersByTimeAsync(17_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2500);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.content).toEqual({ "receiver-name": "Linh ơi" });
  });

  it("keeps the rate-limit window when the browser comes back online", async () => {
    const { calls, controller, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "rate-limited", retryAfterSeconds: 20 });

    controller.handleOffline();
    await vi.advanceTimersByTimeAsync(5000);
    controller.handleOnline();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.content).toEqual({ "receiver-name": "Linh" });
  });

  it("retries a rate limit without details after the backoff", async () => {
    const { calls, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "rate-limited", retryAfterSeconds: null });
    await vi.advanceTimersByTimeAsync(2000);

    expect(calls).toHaveLength(2);
  });

  it("stops after three retries until a change, Lưu ngay or online", async () => {
    const { calls, controller, edit, resolve, status } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    for (const [index, delay] of [2000, 4000, 8000].entries()) {
      await resolve(index, { kind: "transient" });
      await vi.advanceTimersByTimeAsync(delay);
    }
    await resolve(3, { kind: "transient" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(4);
    expect(status().kind).toBe("failed");

    controller.saveNow();
    expect(calls).toHaveLength(5);
    await resolve(4, { kind: "transient" });
    controller.handleOnline();
    expect(calls).toHaveLength(6);
    await resolve(5, { kind: "rejected", status: 403 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(6);

    edit("receiver-name", "Linh ơi");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(7);
  });

  it("waits while offline and saves when the browser is back online", async () => {
    const { calls, controller, edit, network, resolve, status } = setup();
    network.online = false;
    controller.handleOffline();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(5000);
    controller.saveNow();

    expect(calls).toHaveLength(0);
    expect(status()).toEqual({ kind: "offline", message: "Mất kết nối — sẽ lưu khi có mạng" });

    network.online = true;
    controller.handleOnline();
    expect(calls).toHaveLength(1);
    await resolve(0, saved(1));
    expect(status().kind).toBe("saved");
  });

  it("reports a network failure while offline and a later online event", async () => {
    const { calls, controller, edit, resolve, status } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "offline" });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(status().kind).toBe("offline");
    expect(calls).toHaveLength(1);
    controller.handleOnline();
    expect(calls).toHaveLength(2);
  });

  it("marks an offline event with nothing unsaved as saved again once online", () => {
    const { controller, status } = setup();
    controller.handleOffline();
    expect(status().kind).toBe("saved");
    controller.handleOnline();
    expect(status().kind).toBe("saved");
  });

  it("stops saving a draft that is no longer editable", async () => {
    const { calls, controller, edit, resolve, store } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "gone" });

    edit("receiver-name", "Linh ơi");
    controller.saveNow();
    controller.handleOnline();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(store.getState().readOnly).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("shows a validation error and autosaves the next change normally", async () => {
    const { calls, edit, resolve, status, store } = setup();
    edit("final-letter", "Thư");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { fieldErrors: { "final-letter": "Too long" }, kind: "invalid" });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(calls).toHaveLength(1);
    expect(status().kind).toBe("failed");
    expect(store.getState().serverFieldErrors).toHaveProperty("final-letter");

    edit("final-letter", "Thư ngắn");
    expect(store.getState().serverFieldErrors).toEqual({});
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
  });

  it("sends the corrected image list after a delete during a save", async () => {
    const { calls, edit, resolve, store } = setup({
      memories: assetIds.map((assetId) => ({ assetId })),
    });
    edit("final-letter", "Thư");
    await vi.advanceTimersByTimeAsync(1500);
    edit(
      "memories",
      assetIds.slice(1).map((assetId) => ({ assetId })),
    );
    await vi.advanceTimersByTimeAsync(1500);

    await resolve(0, { fieldErrors: { memories: "Not owned" }, kind: "invalid" });

    expect(store.getState().serverFieldErrors).toEqual({});
    expect(calls).toHaveLength(2);
    expect(calls[1]?.content).toMatchObject({
      memories: [{ assetId: assetIds[1] }, { assetId: assetIds[2] }],
    });
  });
});

describe("revision conflicts", () => {
  async function conflicted() {
    const context = setup({}, 4);
    context.edit("receiver-name", "Tab B");
    await vi.advanceTimersByTimeAsync(1500);
    await context.resolve(0, { actualRevision: 5, kind: "conflict" });
    return context;
  }

  it("stops saving and keeps edits until the creator chooses", async () => {
    const { calls, controller, edit, store } = await conflicted();
    edit("receiver-name", "Tab B đã sửa");
    controller.saveNow();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toHaveLength(1);
    expect(store.getState().conflict).toEqual({ actualRevision: 5 });
    expect(store.getState().content).toEqual({ "receiver-name": "Tab B đã sửa" });
  });

  it("keeps my version against the actual revision and resumes autosave", async () => {
    const { calls, controller, edit, resolve, status, store } = await conflicted();

    const keeping = controller.keepMine();
    expect(calls[1]).toMatchObject({ content: { "receiver-name": "Tab B" }, expectedRevision: 5 });
    await resolve(1, saved(6));
    await keeping;

    expect(store.getState()).toMatchObject({ conflict: null, revision: 6 });
    expect(status().kind).toBe("saved");
    edit("receiver-name", "Tab B tiếp");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[2]?.expectedRevision).toBe(6);
  });

  it("shows the banner again when another save wins again", async () => {
    const { calls, controller, resolve, status, store } = await conflicted();

    void controller.keepMine();
    await resolve(1, { actualRevision: 6, kind: "conflict" });

    expect(store.getState().conflict).toEqual({ actualRevision: 6 });
    expect(calls).toHaveLength(2);

    void controller.keepMine();
    await resolve(2, { kind: "transient" });
    expect(store.getState().conflict).toEqual({ actualRevision: 6 });
    expect(status().kind).toBe("failed");
  });

  it("loads the latest version", async () => {
    const { calls, controller, loadDraft, status, store } = await conflicted();
    loadDraft.mockResolvedValueOnce({
      gift: draftGift({ "receiver-name": "Tab A" }, { revision: 5 }),
      kind: "loaded",
    });

    await controller.reloadLatest();

    expect(store.getState()).toMatchObject({
      conflict: null,
      content: { "receiver-name": "Tab A" },
      contentGeneration: 1,
      revision: 5,
    });
    expect(status()).toEqual({ kind: "saved", message: "Đã lưu" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
  });

  it("keeps the banner and the content when the reload fails", async () => {
    const { controller, loadDraft, store } = await conflicted();
    loadDraft.mockResolvedValueOnce({ kind: "failed" });

    await controller.reloadLatest();

    expect(store.getState()).toMatchObject({
      conflict: { actualRevision: 5 },
      content: { "receiver-name": "Tab B" },
      reloadError: true,
    });
  });

  it("treats a missing draft on reload as no longer editable", async () => {
    const { controller, loadDraft, store } = await conflicted();
    loadDraft.mockResolvedValueOnce({ kind: "gone" });

    await controller.reloadLatest();

    expect(store.getState()).toMatchObject({ conflict: null, readOnly: true });
  });
});

describe("flush before dependent actions", () => {
  it("sends a pending change at once and resolves with the new revision", async () => {
    const { calls, controller, edit, resolve } = setup({}, 4);
    edit("receiver-name", "Linh");

    const flushing = controller.flush();
    expect(calls).toHaveLength(1);
    expect(controller.flush()).toBe(flushing);
    await resolve(0, saved(5));

    await expect(flushing).resolves.toEqual({ kind: "saved", revision: 5 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
  });

  it("waits for an in-flight save and sends content changed meanwhile", async () => {
    const { calls, controller, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    edit("receiver-name", "Linh ơi");

    const flushing = controller.flush();
    await resolve(0, saved(1));
    expect(calls[1]).toMatchObject({
      content: { "receiver-name": "Linh ơi" },
      expectedRevision: 1,
    });
    await resolve(1, saved(2));

    await expect(flushing).resolves.toEqual({ kind: "saved", revision: 2 });
  });

  it("resolves saved without a request when nothing is unsaved", async () => {
    const { calls, controller } = setup({}, 7);

    await expect(controller.flush()).resolves.toEqual({ kind: "saved", revision: 7 });
    expect(calls).toHaveLength(0);
  });

  it("does not run while offline, invalid or in conflict", async () => {
    const offline = setup();
    offline.network.online = false;
    offline.edit("receiver-name", "Linh");
    await expect(offline.controller.flush()).resolves.toEqual({ kind: "offline" });
    expect(offline.status().kind).toBe("offline");

    const invalid = setup({ audio: "old-piano" });
    invalid.edit("receiver-name", "Linh");
    await expect(invalid.controller.flush()).resolves.toEqual({ kind: "invalid" });

    const conflict = setup();
    conflict.edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await conflict.resolve(0, { actualRevision: 3, kind: "conflict" });
    await expect(conflict.controller.flush()).resolves.toEqual({
      actualRevision: 3,
      kind: "conflict",
    });

    expect([offline, invalid].every(({ calls }) => calls.length === 0)).toBe(true);
    expect(conflict.calls).toHaveLength(1);
  });

  it("sends once and reports a failed or refused save", async () => {
    const { calls, controller, edit, resolve } = setup();
    edit("receiver-name", "Linh");

    const failing = controller.flush();
    await resolve(0, { kind: "transient" });
    await expect(failing).resolves.toEqual({ kind: "failed" });

    const retried = controller.flush();
    expect(calls).toHaveLength(2);
    await resolve(1, { fieldErrors: {}, kind: "invalid" });
    await expect(retried).resolves.toEqual({ kind: "invalid" });

    await expect(controller.flush()).resolves.toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(2);
  });

  it("reports offline and gone outcomes of its own save", async () => {
    const offline = setup();
    offline.edit("receiver-name", "Linh");
    const first = offline.controller.flush();
    await offline.resolve(0, { kind: "offline" });
    await expect(first).resolves.toEqual({ kind: "offline" });

    const gone = setup();
    gone.edit("receiver-name", "Linh");
    const second = gone.controller.flush();
    await gone.resolve(0, { kind: "gone" });
    await expect(second).resolves.toEqual({ kind: "failed" });
  });

  it("does not send during a rate-limit window", async () => {
    const { calls, controller, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    await resolve(0, { kind: "rate-limited", retryAfterSeconds: 30 });

    await expect(controller.flush()).resolves.toEqual({ kind: "failed" });
    expect(calls).toHaveLength(1);
  });

  it("uses keepalive when asked, and ignores late responses after dispose", async () => {
    const { calls, controller, edit, resolve, store } = setup();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[0]?.options).toEqual({ keepalive: false });

    controller.dispose();
    await resolve(0, saved(1));
    expect(store.getState().revision).toBe(0);
    await expect(controller.flush({ keepalive: true })).resolves.toEqual({ kind: "failed" });
    edit("receiver-name", "Linh ơi");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
  });

  it("finishes a flush started before dispose, including edits typed during a save", async () => {
    const { calls, controller, edit, resolve, store } = setup({}, 2);
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    edit("receiver-name", "Linh ơi");

    // The editor unmounts while the first save is in flight.
    const flushing = controller.flush({ keepalive: true });
    controller.dispose();
    await resolve(0, saved(3));

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      content: { "receiver-name": "Linh ơi" },
      expectedRevision: 3,
      options: { keepalive: true },
    });
    await resolve(1, saved(4));
    await expect(flushing).resolves.toEqual({ kind: "saved", revision: 4 });
    expect(store.getState().revision).toBe(4);

    // Nothing else runs after the flush: later edits are not autosaved.
    edit("receiver-name", "Linh ơi!");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
  });

  it("honors keepalive requested while a normal flush is running", async () => {
    const { calls, controller, edit, resolve } = setup();
    edit("receiver-name", "Linh");
    const first = controller.flush();
    expect(calls[0]?.options).toEqual({ keepalive: false });
    edit("receiver-name", "Linh ơi");

    const second = controller.flush({ keepalive: true });
    expect(second).toBe(first);
    await resolve(0, saved(1));

    expect(calls[1]?.options).toEqual({ keepalive: true });
    await resolve(1, saved(2));
    await expect(first).resolves.toEqual({ kind: "saved", revision: 2 });

    edit("receiver-name", "Linh ơi!");
    void controller.flush();
    expect(calls[2]?.options).toEqual({ keepalive: false });
  });

  it("reports the last saved revision", async () => {
    const { controller, edit, resolve } = setup({}, 2);
    expect(controller.getLastSavedRevision()).toBe(2);

    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);
    expect(controller.getLastSavedRevision()).toBe(2);
    await resolve(0, saved(3));

    expect(controller.getLastSavedRevision()).toBe(3);
  });

  it("can be started again after dispose", async () => {
    const { calls, controller, edit } = setup();
    controller.dispose();
    controller.start();
    controller.start();
    edit("receiver-name", "Linh");
    await vi.advanceTimersByTimeAsync(1500);

    expect(calls).toHaveLength(1);
  });
});
