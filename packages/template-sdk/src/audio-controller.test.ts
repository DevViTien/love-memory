import { describe, expect, it, vi } from "vitest";

import { createMediaElementAudioController, type MediaElementControl } from "./audio-controller";

function createElement(play: () => Promise<void>) {
  return {
    load: vi.fn(),
    muted: false,
    pause: vi.fn(),
    play,
    removeAttribute: vi.fn(),
  } satisfies MediaElementControl;
}

describe("media element audio controller", () => {
  it("plays, pauses, mutes and releases a media element", async () => {
    const element = createElement(vi.fn(() => Promise.resolve()));
    const controller = createMediaElementAudioController(element);

    await expect(controller.play()).resolves.toBe("playing");
    expect(controller.toggleMuted()).toBe(true);
    controller.pause();
    controller.destroy();

    expect(element.pause).toHaveBeenCalledTimes(2);
    expect(element.removeAttribute).toHaveBeenCalledWith("src");
    expect(element.load).toHaveBeenCalledOnce();
  });

  it("turns autoplay rejection into a user-action fallback state", async () => {
    const blocked = createMediaElementAudioController(
      createElement(vi.fn(() => Promise.reject(new DOMException("blocked", "NotAllowedError")))),
    );
    const failed = createMediaElementAudioController(
      createElement(vi.fn(() => Promise.reject(new Error("decode failed")))),
    );

    await expect(blocked.play()).resolves.toBe("blocked");
    await expect(failed.play()).resolves.toBe("failed");
  });
});
