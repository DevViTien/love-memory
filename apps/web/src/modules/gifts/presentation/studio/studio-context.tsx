"use client";

import {
  type GiftPublicationDto,
  type LicensedAudioTrackDto,
  type PlanOfferDto,
} from "@love-memory/contracts";
import { createContext, useContext, type MouseEvent } from "react";

import { type AutosaveController } from "./autosave-controller";
import { type DraftEditorStore } from "./draft-editor-store";

export type StudioNavigation = Readonly<{
  /** Opens the step that holds the field and focuses the field's primary control. */
  openField: (fieldId: string) => void;
  /** Opens a step and focuses its heading. */
  openStep: (stepId: string) => void;
}>;

/** What the `Xuất bản` step needs from the page; it never decides access (the API does). */
export type StudioPublishContext = Readonly<{
  /** A first publish or an update succeeded; the store already holds the new publication. */
  onPublished: (publication: GiftPublicationDto) => void;
  /** A template artifact is registered for the draft's exact version (it can be published). */
  publishable: boolean;
  ownerKind: "anonymous" | "user";
  /** The plans the page offers for a first publish, in catalog order (`gift-plans`). */
  planOffers: readonly PlanOfferDto[];
  signedIn: boolean;
}>;

/** Funnel events of the Studio actions; a no-op while analytics is disabled. */
export type StudioActionReport = (name: "preview_started" | "publish_clicked") => void;

export type StudioContextValue = Readonly<{
  audioTracks: readonly LicensedAudioTrackDto[];
  controller: AutosaveController;
  navigation: StudioNavigation;
  publish: StudioPublishContext;
  report: StudioActionReport;
  store: DraftEditorStore;
}>;

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("Studio components must be rendered inside DraftEditor.");
  return value;
}

/** A same-page link that opens its target without a page load. */
export function studioLinkHandler(open: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    open();
  };
}
