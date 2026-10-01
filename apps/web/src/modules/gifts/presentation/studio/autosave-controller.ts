import {
  selectHasClientErrors,
  selectIsDirty,
  type DraftEditorState,
  type DraftEditorStore,
} from "./draft-editor-store";
import { isDeepEqual, type DraftContent } from "./draft-validation";
import { type DraftRequestOptions, type LoadOutcome, type SaveOutcome } from "./save-draft-request";

export const AUTOSAVE_DELAY_MILLISECONDS = 1500;
export const RETRY_DELAYS_MILLISECONDS: readonly number[] = [2000, 4000, 8000];

export type FlushResult =
  | Readonly<{ kind: "saved"; revision: number }>
  | Readonly<{ actualRevision: number; kind: "conflict" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "offline" }>
  | Readonly<{ kind: "failed" }>;

type TimerHandle = ReturnType<typeof setTimeout>;

export type AutosaveTimers = Readonly<{
  clearTimeout: (handle: TimerHandle) => void;
  now: () => number;
  setTimeout: (callback: () => void, milliseconds: number) => TimerHandle;
}>;

export type AutosaveDependencies = Readonly<{
  isOnline?: () => boolean;
  loadDraft: (publicId: string) => Promise<LoadOutcome>;
  saveDraft: (
    publicId: string,
    content: DraftContent,
    expectedRevision: number,
    options: DraftRequestOptions,
  ) => Promise<SaveOutcome>;
  store: DraftEditorStore;
  timers?: AutosaveTimers;
}>;

export type AutosaveController = Readonly<{
  dispose: () => void;
  /** Settles pending saves for a dependent action; resolves `saved` only when nothing is unsaved. */
  flush: (options?: Readonly<{ keepalive?: boolean }>) => Promise<FlushResult>;
  getLastSavedRevision: () => number;
  handleOffline: () => void;
  handleOnline: () => void;
  keepMine: () => Promise<void>;
  reloadLatest: () => Promise<void>;
  /** `Lưu ngay`: send the latest content without waiting for the delay. */
  saveNow: () => void;
  /** Starts reacting to content changes; can be called again after `dispose`. */
  start: () => void;
}>;

const defaultTimers: AutosaveTimers = {
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
};

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function toFlushResult(outcome: SaveOutcome): FlushResult {
  switch (outcome.kind) {
    case "saved":
      return { kind: "saved", revision: outcome.gift.revision };
    case "conflict":
      return { actualRevision: outcome.actualRevision, kind: "conflict" };
    case "invalid":
      return { kind: "invalid" };
    case "offline":
      return { kind: "offline" };
    default:
      return { kind: "failed" };
  }
}

/**
 * Debounced, single-flight, latest-wins autosave. It owns every timer and the one request in
 * flight, never logs, and never sends content with client-side errors or during a conflict.
 */
export function createAutosaveController({
  isOnline = defaultIsOnline,
  loadDraft,
  saveDraft,
  store,
  timers = defaultTimers,
}: AutosaveDependencies): AutosaveController {
  const publicId = store.getState().context.publicId;
  let debounceTimer: TimerHandle | null = null;
  let retryTimer: TimerHandle | null = null;
  let retryCount = 0;
  let rateLimitedUntil = 0;
  let queued = false;
  let inFlight: Promise<void> | null = null;
  let lastOutcome: Readonly<{ outcome: SaveOutcome; sent: DraftContent }> | null = null;
  let flushing: Promise<FlushResult> | null = null;
  /** Whether any caller of the running flush asked for `keepalive`; later sends honor it. */
  let flushKeepalive = false;
  let unsubscribe: (() => void) | null = null;
  let disposed = true;

  function clearDebounce() {
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  function clearRetry() {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
  }

  function isBlocked(state: DraftEditorState): boolean {
    return disposed || state.readOnly || state.conflict !== null;
  }

  function resetRetries() {
    retryCount = 0;
    clearRetry();
  }

  function send(content: DraftContent, expectedRevision: number): Promise<void> {
    store.getState().beginSave();
    lastOutcome = null;
    // Every send while a keepalive flush runs uses keepalive, including a queued follow-up save.
    const request = saveDraft(publicId, content, expectedRevision, {
      keepalive: flushKeepalive,
    }).then((outcome) => {
      if (inFlight === request) inFlight = null;
      // After dispose, only a flush that was already running still needs the response: its
      // revision is the `expectedRevision` of the edits it sends next.
      if (!disposed || flushing !== null) handleOutcome(outcome, content);
    });
    inFlight = request;
    return request;
  }

  function scheduleRetry(minimumMilliseconds: number) {
    clearRetry();
    if (retryCount >= RETRY_DELAYS_MILLISECONDS.length) return;
    const delay = Math.max(RETRY_DELAYS_MILLISECONDS[retryCount] ?? 0, minimumMilliseconds);
    retryCount += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      attemptSave();
    }, delay);
  }

  function handleOutcome(outcome: SaveOutcome, sent: DraftContent) {
    lastOutcome = { outcome, sent };
    store.getState().applyOutcome(outcome, sent);
    const wasQueued = queued;
    queued = false;
    if (outcome.kind === "rate-limited") {
      rateLimitedUntil = timers.now() + (outcome.retryAfterSeconds ?? 0) * 1000;
    }
    // A disposed controller starts no timer or request of its own; a running flush decides.
    if (disposed) return;

    switch (outcome.kind) {
      case "saved":
        resetRetries();
        if (wasQueued || (debounceTimer === null && selectIsDirty(store.getState()))) {
          attemptSave();
        }
        return;
      case "conflict":
      case "gone":
        clearDebounce();
        resetRetries();
        return;
      case "invalid":
        if (wasQueued && !isDeepEqual(store.getState().content, sent)) attemptSave();
        return;
      case "offline":
        clearRetry();
        return;
      case "transient":
        scheduleRetry(0);
        return;
      case "rate-limited":
        scheduleRetry((outcome.retryAfterSeconds ?? 0) * 1000);
        return;
      case "rejected":
        return;
    }
  }

  /** Sends the latest content when it is dirty and allowed; queues it behind a request. */
  function attemptSave() {
    clearDebounce();
    const state = store.getState();
    if (isBlocked(state) || selectHasClientErrors(state)) return;
    if (inFlight) {
      queued = true;
      return;
    }
    if (!selectIsDirty(state)) {
      state.setStatus("saved");
      return;
    }
    if (!isOnline()) {
      state.setStatus("offline");
      return;
    }
    if (timers.now() < rateLimitedUntil) {
      // The rate-limit retry timer sends the latest content once the window has passed.
      if (retryTimer === null) scheduleRetry(rateLimitedUntil - timers.now());
      return;
    }
    void send(state.content, state.revision);
  }

  function handleContentChange() {
    const state = store.getState();
    if (isBlocked(state)) return;
    resetRetries();
    if (!selectIsDirty(state)) {
      clearDebounce();
      if (!state.inFlight) state.setStatus("saved");
      return;
    }
    if (!isOnline()) {
      clearDebounce();
      state.setStatus("offline");
      return;
    }
    if (state.status !== "saving") state.setStatus("pending");
    clearDebounce();
    debounceTimer = timers.setTimeout(() => {
      debounceTimer = null;
      attemptSave();
    }, AUTOSAVE_DELAY_MILLISECONDS);
  }

  async function settle(): Promise<FlushResult> {
    let sentByFlush = false;
    for (;;) {
      if (inFlight) {
        await inFlight;
        continue;
      }
      const state = store.getState();
      // `disposed` is not checked here: a flush started before `dispose()` (the editor unmounting)
      // still sends the edits typed while a save was in flight.
      if (state.readOnly) return { kind: "failed" };
      if (state.conflict)
        return { actualRevision: state.conflict.actualRevision, kind: "conflict" };
      if (selectHasClientErrors(state)) return { kind: "invalid" };
      if (!selectIsDirty(state)) return { kind: "saved", revision: state.revision };
      if (lastOutcome !== null && lastOutcome.outcome.kind !== "saved") {
        // A flush sends once; content the server already refused is not sent again.
        const refused =
          (lastOutcome.outcome.kind === "invalid" || lastOutcome.outcome.kind === "rejected") &&
          isDeepEqual(state.content, lastOutcome.sent);
        if (sentByFlush || refused) return toFlushResult(lastOutcome.outcome);
      }
      if (!isOnline()) {
        state.setStatus("offline");
        return { kind: "offline" };
      }
      if (timers.now() < rateLimitedUntil) {
        // The last save was rate limited. `handleContentChange` cleared the retry timer and the
        // flush cleared the debounce: without a new timer the latest content would never be sent.
        if (!disposed && retryTimer === null) scheduleRetry(rateLimitedUntil - timers.now());
        state.setStatus("failed");
        return { kind: "failed" };
      }
      sentByFlush = true;
      queued = false;
      resetRetries();
      void send(state.content, state.revision);
    }
  }

  function flush(options: Readonly<{ keepalive?: boolean }> = {}): Promise<FlushResult> {
    if (disposed && flushing === null) return Promise.resolve({ kind: "failed" });
    clearDebounce();
    // A later keepalive request upgrades a running flush, so its remaining sends survive unload.
    if (options.keepalive === true) flushKeepalive = true;
    flushing ??= settle()
      .catch((): FlushResult => ({ kind: "failed" }))
      .finally(() => {
        flushing = null;
        flushKeepalive = false;
      });
    return flushing;
  }

  async function keepMine() {
    const { conflict, content } = store.getState();
    if (disposed || conflict === null || inFlight) return;
    resetRetries();
    await send(content, conflict.actualRevision);
  }

  async function reloadLatest() {
    if (disposed || inFlight) return;
    const outcome = await loadDraft(publicId);
    if (disposed) return;
    const state = store.getState();
    if (outcome.kind === "loaded") {
      clearDebounce();
      resetRetries();
      rateLimitedUntil = 0;
      lastOutcome = null;
      state.replaceFromServer(outcome.gift);
    } else if (outcome.kind === "gone") {
      state.applyOutcome({ kind: "gone" }, state.content);
    } else {
      state.setReloadError(true);
    }
  }

  return {
    dispose() {
      disposed = true;
      clearDebounce();
      clearRetry();
      unsubscribe?.();
      unsubscribe = null;
    },
    flush,
    getLastSavedRevision: () => store.getState().revision,
    handleOffline() {
      clearDebounce();
      store.getState().setOffline(true);
    },
    handleOnline() {
      const state = store.getState();
      state.setOffline(false);
      if (isBlocked(state)) return;
      resetRetries();
      // The `429` window still holds: `attemptSave` schedules the send for its end.
      if (selectIsDirty(store.getState())) attemptSave();
    },
    keepMine,
    reloadLatest,
    saveNow() {
      resetRetries();
      attemptSave();
    },
    start() {
      if (!disposed) return;
      disposed = false;
      unsubscribe = store.subscribe((state, previous) => {
        if (state.content !== previous.content) handleContentChange();
      });
    },
  };
}
