export type AudioPlaybackResult = "blocked" | "failed" | "playing";

export type MediaElementControl = Pick<
  HTMLMediaElement,
  "load" | "muted" | "pause" | "play" | "removeAttribute"
>;

function isAutoplayPolicyError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function createMediaElementAudioController(element: MediaElementControl) {
  return {
    destroy() {
      element.pause();
      element.removeAttribute("src");
      element.load();
    },
    pause() {
      element.pause();
    },
    async play(): Promise<AudioPlaybackResult> {
      try {
        await element.play();
        return "playing";
      } catch (error) {
        return isAutoplayPolicyError(error) ? "blocked" : "failed";
      }
    },
    toggleMuted(): boolean {
      element.muted = !element.muted;
      return element.muted;
    },
  } as const;
}
