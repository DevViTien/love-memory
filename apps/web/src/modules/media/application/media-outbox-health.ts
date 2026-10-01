/** A due media job older than this means neither a dispatched drain nor the sweep is running. */
export const MEDIA_OUTBOX_STALL_THRESHOLD_MILLISECONDS = 10 * 60 * 1000;

export interface MediaOutboxMonitor {
  /**
   * Whether a claimable `pending` `media.process.v1` job became available at or before `cutoff`.
   * Jobs scheduled for a later retry (`availableAt` in the future) never match.
   */
  hasOverdueJob: (cutoff: Date) => Promise<boolean>;
}

/** Named in the readiness log only; the readiness response itself stays generic. */
export class MediaOutboxStalledError extends Error {
  constructor() {
    super("A media processing job has been waiting longer than the stall threshold.");
    this.name = "MediaOutboxStalledError";
  }
}

export async function assertMediaOutboxFlowing({
  monitor,
  now = new Date(),
}: Readonly<{ monitor: MediaOutboxMonitor; now?: Date }>): Promise<void> {
  const cutoff = new Date(now.getTime() - MEDIA_OUTBOX_STALL_THRESHOLD_MILLISECONDS);
  if (await monitor.hasOverdueJob(cutoff)) throw new MediaOutboxStalledError();
}
