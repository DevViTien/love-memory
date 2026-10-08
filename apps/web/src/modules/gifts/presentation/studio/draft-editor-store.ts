import { type GiftDraftDto, type GiftPublicationSummary } from "@love-memory/contracts";
import { type TemplateManifest } from "@love-memory/template-sdk";
import { createStore, type StoreApi } from "zustand/vanilla";

import {
  firstInvalidField,
  isDeepEqual,
  mapServerFieldErrors,
  stepCompletion,
  validateDraftContent,
  withFieldValue,
  type DraftContent,
  type FieldErrors,
  type InvalidField,
} from "./draft-validation";
import { type SaveOutcome } from "./save-draft-request";
import { resolveStudioSteps, type StudioStep } from "./studio-steps";

export type SaveStatus = "failed" | "offline" | "pending" | "saved" | "saving";

export const SAVE_STATUS_MESSAGES = {
  failed: "Chưa lưu được — thử lại",
  offline: "Mất kết nối — sẽ lưu khi có mạng",
  saved: "Đã lưu",
  saving: "Đang lưu…",
} as const;

export function invalidContentMessage(label: string): string {
  return `Chưa lưu được: ${label} chưa hợp lệ`;
}

/** Fixed per editor: the bound manifest, its steps and the selectable catalog tracks. */
export type DraftEditorContext = Readonly<{
  manifest: TemplateManifest;
  publicId: string;
  selectableTrackIds: ReadonlySet<string>;
  steps: readonly StudioStep[];
}>;

type DerivedCache = Readonly<{
  completion: WeakMap<DraftContent, Readonly<Record<string, boolean>>>;
  errors: WeakMap<DraftContent, FieldErrors>;
  firstInvalid: WeakMap<DraftContent, InvalidField | null>;
}>;

export type DraftEditorData = Readonly<{
  conflict: Readonly<{ actualRevision: number }> | null;
  content: DraftContent;
  /** Increases only when the stored draft replaces the content; image fields remount on it. */
  contentGeneration: number;
  context: DraftEditorContext;
  generalError: string | null;
  inFlight: boolean;
  /** The content of the last successful save, or the loaded content. */
  lastSavedContent: DraftContent;
  /**
   * The current publication of a published gift (what recipients receive), or `null` for a draft.
   * The editor then edits the gift's working copy.
   */
  publication: GiftPublicationSummary | null;
  /** A publish request is running: every field is read-only and edits are ignored. */
  publishing: boolean;
  /** The draft is gone or no longer editable; nothing is sent any more. */
  readOnly: boolean;
  reloadError: boolean;
  /** The revision of the last successful save, or the loaded revision. */
  revision: number;
  serverFieldErrors: FieldErrors;
  status: SaveStatus;
}>;

export type DraftEditorActions = Readonly<{
  applyOutcome: (outcome: SaveOutcome, sentContent: DraftContent) => void;
  /** Field errors of a rejected dependent action (publish): shown inline, no save status. */
  applyServerFieldErrors: (fieldErrors: Readonly<Record<string, string>>) => void;
  beginSave: () => void;
  replaceFromServer: (gift: GiftDraftDto) => void;
  setFieldValue: (fieldId: string, raw: unknown) => void;
  setOffline: (offline: boolean) => void;
  /** A publish succeeded: its revision is now what recipients receive. */
  setPublication: (publication: GiftPublicationSummary) => void;
  setPublishing: (publishing: boolean) => void;
  setReloadError: (reloadError: boolean) => void;
  setStatus: (status: SaveStatus) => void;
}>;

export type DraftEditorState = DraftEditorData & DraftEditorActions;
export type DraftEditorStore = StoreApi<DraftEditorState>;

export type DraftEditorInit = Readonly<{
  gift: GiftDraftDto;
  manifest: TemplateManifest;
  selectableTrackIds: Iterable<string>;
}>;

const caches = new WeakMap<DraftEditorContext, DerivedCache>();

function cacheFor(context: DraftEditorContext): DerivedCache {
  let cache = caches.get(context);
  if (!cache) {
    cache = { completion: new WeakMap(), errors: new WeakMap(), firstInvalid: new WeakMap() };
    caches.set(context, cache);
  }
  return cache;
}

function memo<T>(map: WeakMap<DraftContent, T>, content: DraftContent, compute: () => T): T {
  if (map.has(content)) return map.get(content) as T;
  const value = compute();
  map.set(content, value);
  return value;
}

/**
 * One store per editor instance, never a module singleton, and never persisted: gift text does
 * not reach browser storage.
 */
export function createDraftEditorStore({
  gift,
  manifest,
  selectableTrackIds,
}: DraftEditorInit): DraftEditorStore {
  const context: DraftEditorContext = {
    manifest,
    publicId: gift.publicId,
    selectableTrackIds: new Set(selectableTrackIds),
    steps: resolveStudioSteps(manifest),
  };

  return createStore<DraftEditorState>()((set, get) => ({
    conflict: null,
    content: gift.content,
    contentGeneration: 0,
    context,
    generalError: null,
    inFlight: false,
    lastSavedContent: gift.content,
    publication: gift.publication,
    publishing: false,
    readOnly: false,
    reloadError: false,
    revision: gift.revision,
    serverFieldErrors: {},
    status: "saved",

    applyOutcome(outcome, sentContent) {
      const state = get();
      switch (outcome.kind) {
        case "saved":
          set({
            conflict: null,
            generalError: null,
            inFlight: false,
            lastSavedContent: sentContent,
            publication: outcome.gift.publication,
            reloadError: false,
            revision: outcome.gift.revision,
            serverFieldErrors: {},
            status: isDeepEqual(state.content, sentContent) ? "saved" : "pending",
          });
          return;
        case "conflict":
          set({
            conflict: { actualRevision: outcome.actualRevision },
            inFlight: false,
            status: "pending",
          });
          return;
        case "gone":
          set({ conflict: null, inFlight: false, readOnly: true, status: "failed" });
          return;
        case "invalid": {
          const mapped = mapServerFieldErrors(state.context.manifest, outcome.fieldErrors);
          // A late response must not mark fields the creator changed after sending.
          const serverFieldErrors = Object.fromEntries(
            Object.entries(mapped.byField).filter(([fieldId]) =>
              isDeepEqual(state.content[fieldId], sentContent[fieldId]),
            ),
          );
          set({
            generalError: mapped.general,
            inFlight: false,
            serverFieldErrors,
            status: "failed",
          });
          return;
        }
        case "offline":
          set({ inFlight: false, status: "offline" });
          return;
        default:
          set({ inFlight: false, status: "failed" });
      }
    },

    applyServerFieldErrors(fieldErrors) {
      const mapped = mapServerFieldErrors(get().context.manifest, fieldErrors);
      set({ serverFieldErrors: mapped.byField });
    },

    beginSave() {
      set({ inFlight: true, status: "saving" });
    },

    replaceFromServer(stored) {
      set((state) => ({
        conflict: null,
        content: stored.content,
        contentGeneration: state.contentGeneration + 1,
        generalError: null,
        inFlight: false,
        lastSavedContent: stored.content,
        publication: stored.publication,
        readOnly: false,
        reloadError: false,
        revision: stored.revision,
        serverFieldErrors: {},
        status: "saved",
      }));
    },

    setFieldValue(fieldId, raw) {
      set((state) => {
        // Read-only states: a late change (an upload that finishes meanwhile) changes nothing.
        // Returning the same state object notifies no subscriber.
        if (state.publishing || state.readOnly) return state;
        const content = withFieldValue(state.context.manifest, state.content, fieldId, raw);
        if (content === state.content) return state;
        const serverFieldErrors = { ...state.serverFieldErrors };
        delete serverFieldErrors[fieldId];
        return { content, serverFieldErrors };
      });
    },

    setOffline(offline) {
      const state = get();
      if (offline) {
        if (selectIsDirty(state) || state.inFlight) set({ status: "offline" });
      } else if (state.status === "offline") {
        set({ status: selectIsDirty(state) ? "pending" : "saved" });
      }
    },

    setPublication(publication) {
      set({ publication });
    },

    setPublishing(publishing) {
      set({ publishing });
    },

    setReloadError(reloadError) {
      set({ reloadError });
    },

    setStatus(status) {
      set({ status });
    },
  }));
}

export function selectClientErrors(state: DraftEditorData): FieldErrors {
  const { context } = state;
  return memo(cacheFor(context).errors, state.content, () =>
    validateDraftContent(context.manifest, state.content, context.selectableTrackIds),
  );
}

const mergedErrors = new WeakMap<DraftEditorData, FieldErrors>();

/** Client-side errors first, then the server's errors for fields the creator has not changed. */
export function selectFieldErrors(state: DraftEditorData): FieldErrors {
  const clientErrors = selectClientErrors(state);
  if (Object.keys(state.serverFieldErrors).length === 0) return clientErrors;
  let merged = mergedErrors.get(state);
  if (!merged) {
    merged = { ...state.serverFieldErrors, ...clientErrors };
    mergedErrors.set(state, merged);
  }
  return merged;
}

export function selectHasClientErrors(state: DraftEditorData): boolean {
  return Object.keys(selectClientErrors(state)).length > 0;
}

export function selectFirstInvalidField(state: DraftEditorData): InvalidField | null {
  const { context } = state;
  return memo(cacheFor(context).firstInvalid, state.content, () =>
    firstInvalidField(context.manifest, context.steps, selectClientErrors(state)),
  );
}

export function selectStepCompletion(state: DraftEditorData): Readonly<Record<string, boolean>> {
  const { context } = state;
  return memo(cacheFor(context).completion, state.content, () =>
    stepCompletion(context.manifest, context.steps, state.content, selectClientErrors(state)),
  );
}

/** Every template step is complete, as the step indicators show it (not `Xem trước`/`Xuất bản`). */
export function selectTemplateStepsComplete(state: DraftEditorData): boolean {
  const completion = selectStepCompletion(state);
  return state.context.steps
    .filter((step) => step.kind === "template")
    .every((step) => completion[step.id] === true);
}

export function selectIsDirty(state: DraftEditorData): boolean {
  return (
    state.content !== state.lastSavedContent && !isDeepEqual(state.content, state.lastSavedContent)
  );
}

/**
 * The saved working copy of a published gift is newer than what recipients receive. `false` for a
 * draft, which has no publication yet.
 */
export function selectHasUnpublishedChanges(state: DraftEditorData): boolean {
  return state.publication !== null && state.revision > state.publication.revision;
}

/**
 * `Cập nhật món quà` has something to publish: unpublished saved changes, or a change still
 * waiting to be saved (the action saves it first).
 */
export function selectCanUpdatePublication(state: DraftEditorData): boolean {
  return selectHasUnpublishedChanges(state) || selectIsDirty(state);
}

/**
 * Something could be lost by leaving: unsaved content, a request in flight or a conflict. A draft
 * that is no longer editable can save nothing, so leaving it loses nothing either.
 */
export function selectShouldWarnOnLeave(state: DraftEditorData): boolean {
  if (state.readOnly) return false;
  return selectIsDirty(state) || state.inFlight || state.conflict !== null;
}

/** Fields are read-only while publishing and once the draft is no longer editable. */
export function selectFieldsDisabled(state: DraftEditorData): boolean {
  return state.publishing || state.readOnly;
}

/** `Lưu ngay` is enabled only when there is something that may be sent. */
export function selectCanSaveNow(state: DraftEditorData): boolean {
  return (
    !state.readOnly &&
    state.conflict === null &&
    selectIsDirty(state) &&
    !selectHasClientErrors(state)
  );
}

export type StatusView =
  | Readonly<{ fieldId: string; kind: "invalid"; label: string; message: string }>
  | Readonly<{ kind: "failed" | "offline" | "saved" | "saving"; message: string }>
  | Readonly<{ kind: "hidden" }>;

const statusViews = new WeakMap<DraftEditorData, StatusView>();

function computeStatusView(state: DraftEditorData): StatusView {
  if (state.readOnly) return { kind: "hidden" };
  if (state.conflict !== null) {
    // The conflict banner speaks for itself; only a failed `Giữ bản của tôi` adds a status.
    return state.status === "failed" || state.status === "offline"
      ? { kind: state.status, message: SAVE_STATUS_MESSAGES[state.status] }
      : { kind: "hidden" };
  }
  const invalid = selectFirstInvalidField(state);
  if (invalid) {
    return { ...invalid, kind: "invalid", message: invalidContentMessage(invalid.label) };
  }
  if (state.status === "offline" || state.status === "failed") {
    return { kind: state.status, message: SAVE_STATUS_MESSAGES[state.status] };
  }
  if (state.inFlight || state.status !== "saved" || selectIsDirty(state)) {
    return { kind: "saving", message: SAVE_STATUS_MESSAGES.saving };
  }
  return { kind: "saved", message: SAVE_STATUS_MESSAGES.saved };
}

/** The one save status to display; stable for a given state. */
export function selectStatusView(state: DraftEditorData): StatusView {
  let view = statusViews.get(state);
  if (!view) {
    view = computeStatusView(state);
    statusViews.set(state, view);
  }
  return view;
}
