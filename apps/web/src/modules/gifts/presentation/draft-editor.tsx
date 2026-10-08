"use client";

import {
  type AnalyticsContext,
  type GiftDraftDto,
  type LicensedAudioTrackDto,
} from "@love-memory/contracts";
import { type TemplateManifest } from "@love-memory/template-sdk";
import { Button } from "@love-memory/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { createAnalyticsClient } from "@/modules/analytics/presentation/analytics-client";
import { trackStudioFunnel } from "@/modules/analytics/presentation/studio-funnel";

import { createAutosaveController } from "./studio/autosave-controller";
import { ConflictBanner, ReadOnlyAlert } from "./studio/conflict-banner";
import {
  createDraftEditorStore,
  selectHasUnpublishedChanges,
  selectIsDirty,
  selectShouldWarnOnLeave,
  selectTemplateStepsComplete,
} from "./studio/draft-editor-store";
import { PublishedPanel } from "./studio/published-panel";
import { ReadinessStep } from "./studio/readiness-step";
import { SaveStatusBar } from "./studio/save-status-bar";
import { loadDraft, saveDraft } from "./studio/save-draft-request";
import { StudioContext, type StudioContextValue } from "./studio/studio-context";
import { StudioField } from "./studio/studio-field";
import { StudioStepNav } from "./studio/studio-step-nav";
import {
  findStepOfField,
  resolveStudioLocation,
  stepSearch,
  studioFieldInputId,
  studioStepHeadingId,
} from "./studio/studio-steps";

type DraftEditorProps = Readonly<{
  /** The funnel analytics context from the page; `null` (analytics disabled) sends nothing. */
  analytics?: AnalyticsContext | null;
  audioTracks: readonly LicensedAudioTrackDto[];
  gift: GiftDraftDto;
  manifest: TemplateManifest;
  /** Whether the bound template version has a registered artifact, so it can be published. */
  publishable?: boolean;
  /** The internal publish entitlement; off unless the page says otherwise. */
  publishEnabled?: boolean;
  signedIn?: boolean;
}>;

type PendingFocus = Readonly<{ elementId: string; scroll: boolean; stepId: string }>;

function focusElement({ elementId, scroll, stepId }: PendingFocus) {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (scroll) {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    element.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }
  element.focus({ preventScroll: scroll });
  if (document.activeElement === element) return;
  // A disabled control (an image picker at its limit or while cropping) cannot take focus: use the
  // field's focusable legend, or else the step heading.
  const fallback =
    element.closest("fieldset")?.querySelector<HTMLElement>("legend[tabindex]") ??
    document.getElementById(studioStepHeadingId(stepId));
  fallback?.focus({ preventScroll: true });
}

/**
 * The Studio editor shell: one store and one autosave controller per mount, steps addressed by
 * `?step=` (with `?field=` deep links), and the browser events that keep a draft safe. A published
 * gift gets the published panel above the same editor, which then edits its working copy.
 */
export function DraftEditor({
  analytics = null,
  audioTracks,
  gift,
  manifest,
  publishable = true,
  publishEnabled = false,
  signedIn = false,
}: DraftEditorProps) {
  const router = useRouter();
  // The creator funnel ends at the first publish: no Studio event for a published gift.
  const [funnelOpen, setFunnelOpen] = useState(gift.status === "draft");
  const [store] = useState(() =>
    createDraftEditorStore({
      gift,
      manifest,
      selectableTrackIds: audioTracks.map((track) => track.id),
    }),
  );
  const [controller] = useState(() =>
    createAutosaveController({
      loadDraft: (publicId) => loadDraft(publicId),
      saveDraft: (publicId, content, expectedRevision, options) =>
        saveDraft(publicId, content, expectedRevision, options),
      store,
    }),
  );
  // Keyed on the values, not the prop object: an equal context keeps the client and tracker.
  const analyticsGiftRef = funnelOpen ? analytics?.giftRef : undefined;
  const analyticsTemplateId = funnelOpen ? analytics?.templateId : undefined;
  const analyticsTemplateVersion = funnelOpen ? analytics?.templateVersion : undefined;
  const analyticsClient = useMemo(
    () =>
      createAnalyticsClient({
        context:
          analyticsGiftRef && analyticsTemplateId && analyticsTemplateVersion
            ? {
                giftRef: analyticsGiftRef,
                templateId: analyticsTemplateId,
                templateVersion: analyticsTemplateVersion,
              }
            : null,
      }),
    [analyticsGiftRef, analyticsTemplateId, analyticsTemplateVersion],
  );
  const steps = store.getState().context.steps;
  const searchParams = useSearchParams();
  const location = resolveStudioLocation(steps, manifest, {
    field: searchParams.get("field"),
    step: searchParams.get("step"),
  });
  const activeStepId = location.stepId;

  const pendingFocus = useRef<PendingFocus | null>(
    location.focusFieldId === null
      ? null
      : {
          elementId: studioFieldInputId(location.focusFieldId),
          scroll: true,
          stepId: location.stepId,
        },
  );
  const initialStepId = useRef(activeStepId);
  const previousStepId = useRef(activeStepId);
  const [, setFocusTick] = useState(0);

  const navigation = useMemo(() => {
    function open(stepId: string, focus: PendingFocus) {
      pendingFocus.current = focus;
      window.history.pushState(null, "", stepSearch(stepId));
      // Also re-render when the step is already active, so the focus effect runs.
      setFocusTick((tick) => tick + 1);
    }
    return {
      openField(fieldId: string) {
        const step = findStepOfField(steps, fieldId);
        if (!step) return;
        open(step.id, { elementId: studioFieldInputId(fieldId), scroll: true, stepId: step.id });
      },
      openStep(stepId: string) {
        open(stepId, { elementId: studioStepHeadingId(stepId), scroll: false, stepId });
      },
    };
  }, [steps]);

  // The URL always names the resolved step: a missing or unknown `?step=` becomes the step that
  // opened (so the back action returns to it), and a resolved `?field=` deep link is replaced by
  // its `?step=` so a reload does not refocus.
  useEffect(() => {
    const search = stepSearch(initialStepId.current);
    if (window.location.search !== search) window.history.replaceState(null, "", search);
  }, []);

  // Focus follows a step change: the requested field, or else the new step's heading.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending && pending.stepId === activeStepId) {
      pendingFocus.current = null;
      focusElement(pending);
    } else if (!pending && previousStepId.current !== activeStepId) {
      focusElement({
        elementId: studioStepHeadingId(activeStepId),
        scroll: false,
        stepId: activeStepId,
      });
    }
    previousStepId.current = activeStepId;
  });

  useEffect(() => {
    controller.start();
    const handleOnline = () => controller.handleOnline();
    const handleOffline = () => controller.handleOffline();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") void controller.flush({ keepalive: true });
    };
    // `pagehide` also covers unloads and bfcache entries where `visibilitychange` does not fire.
    const handlePageHide = () => void controller.flush({ keepalive: true });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibility);
      // Leaving through an in-app link: send a pending change before the editor goes away. The
      // flush starts before `dispose()`, so it still finishes a save in flight and then sends the
      // edits typed meanwhile; `dispose()` only stops timers and new autosaves.
      void controller.flush({ keepalive: true });
      controller.dispose();
    };
  }, [controller]);

  // The creator funnel: `customization_started` and `required_content_completed` from saves.
  useEffect(
    () =>
      trackStudioFunnel({
        client: analyticsClient,
        isComplete: selectTemplateStepsComplete,
        isDirty: selectIsDirty,
        store,
      }),
    [analyticsClient, store],
  );

  const shouldWarnOnLeave = useStore(store, selectShouldWarnOnLeave);
  const publication = useStore(store, (state) => state.publication);
  const hasUnpublishedChanges = useStore(store, selectHasUnpublishedChanges);
  useEffect(() => {
    if (!shouldWarnOnLeave) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the prompt only when `returnValue` is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldWarnOnLeave]);

  // `ownerKind` comes from the page props, so a claim (which refreshes the page) enables publishing.
  const context = useMemo<StudioContextValue>(
    () => ({
      audioTracks,
      controller,
      navigation,
      publish: {
        enabled: publishEnabled,
        onPublished: () => {
          setFunnelOpen(false);
          // The server page re-renders the aside for a published gift; this editor keeps its state.
          router.refresh();
        },
        ownerKind: gift.ownerKind,
        publishable,
        signedIn,
      },
      report: analyticsClient.send,
      store,
    }),
    [
      analyticsClient,
      audioTracks,
      controller,
      gift.ownerKind,
      navigation,
      publishable,
      publishEnabled,
      router,
      signedIn,
      store,
    ],
  );
  const openStep = useCallback((stepId: string) => navigation.openStep(stepId), [navigation]);

  return (
    <StudioContext.Provider value={context}>
      {publication ? (
        <div className="mb-8">
          <PublishedPanel hasUnpublishedChanges={hasUnpublishedChanges} publication={publication} />
        </div>
      ) : null}
      {publishable ? null : (
        <p
          className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900"
          role="note"
        >
          Phiên bản mẫu của bản nháp này chưa hỗ trợ xuất bản. Bạn vẫn có thể chỉnh sửa và xem
          trước, nhưng chưa thể gửi quà.
        </p>
      )}
      <StudioStepNav activeStepId={activeStepId} />
      <ConflictBanner />
      <ReadOnlyAlert />
      {steps.map((step, index) => {
        const previous = steps[index - 1];
        const next = steps[index + 1];
        const headingId = studioStepHeadingId(step.id);
        return (
          // Inactive steps are hidden, not unmounted, so image uploads keep running.
          <section
            aria-labelledby={headingId}
            className="space-y-6"
            hidden={step.id !== activeStepId}
            key={step.id}
          >
            <h2
              className="text-2xl font-black tracking-tight text-stone-900 focus:outline-none"
              id={headingId}
              tabIndex={-1}
            >
              {step.label}
            </h2>
            {step.kind === "template" ? (
              step.fieldIds.map((fieldId) => {
                const field = manifest.fields.find((candidate) => candidate.id === fieldId);
                return field ? <StudioField field={field} key={fieldId} /> : null;
              })
            ) : (
              <ReadinessStep kind={step.kind} />
            )}
            <div className="flex flex-wrap justify-between gap-3 pt-2">
              {previous ? (
                <Button onClick={() => openStep(previous.id)} variant="outline">
                  Quay lại
                </Button>
              ) : (
                <span />
              )}
              {next ? <Button onClick={() => openStep(next.id)}>Tiếp tục</Button> : null}
            </div>
          </section>
        );
      })}
      <SaveStatusBar />
    </StudioContext.Provider>
  );
}
