import { type AnalyticsClient } from "./analytics-client";

/** The parts of the Studio editor state the funnel reads. */
export type StudioFunnelState = Readonly<{
  contentGeneration: number;
  revision: number;
  status: string;
}>;

export type StudioFunnelStore<TState extends StudioFunnelState> = Readonly<{
  getState: () => TState;
  subscribe: (listener: (state: TState, previous: TState) => void) => () => void;
}>;

export type TrackStudioFunnelInput<TState extends StudioFunnelState> = Readonly<{
  client: AnalyticsClient;
  /** Whether every template step (not `Xem trước` or `Xuất bản`) is complete for the content. */
  isComplete: (state: TState) => boolean;
  /** Whether the content on screen differs from the last saved content. */
  isDirty: (state: TState) => boolean;
  store: StudioFunnelStore<TState>;
}>;

/**
 * The creator funnel of one Studio editor (`funnel-analytics` "Creator funnel events in the
 * Studio"). It listens to the editor store and returns the unsubscribe function.
 *
 * - `customization_started`: a successful save of a creator edit, seen as a higher `revision` with
 *   an unchanged `contentGeneration` (a conflict reload bumps the generation and never counts).
 * - `required_content_completed`: a successful save (the same transition) that leaves the content
 *   on screen equal to the saved content with every template step complete, after a state in this
 *   page in which one was not. Only a real save counts: an undo back to the saved value, or a
 *   conflict reload, also reads as "saved" without any save.
 *
 * Loading, step navigation and failed saves change neither, so they send nothing. Both events are
 * sent at most once per gift and tab. The store is passed in, so this module depends on no other.
 */
export function trackStudioFunnel<TState extends StudioFunnelState>({
  client,
  isComplete,
  isDirty,
  store,
}: TrackStudioFunnelInput<TState>): () => void {
  let sawIncomplete = !isComplete(store.getState());

  return store.subscribe((state, previous) => {
    const saved =
      state.revision > previous.revision && state.contentGeneration === previous.contentGeneration;
    if (saved) client.sendOnce("customization_started");

    if (!isComplete(state)) {
      sawIncomplete = true;
    } else if (saved && sawIncomplete && !isDirty(state)) {
      client.sendOnce("required_content_completed");
    }
  });
}
