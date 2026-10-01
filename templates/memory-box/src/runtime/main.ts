import { createMemoryBoxController, type MemoryBoxController } from "./controller";
import { createPhotoLoader } from "./images";
import { createPoster, listenToParent } from "./protocol";
import { createDomView } from "./render";

/**
 * Starts Memory Box in the artifact document: wires the controller to the DOM, timers and the
 * parent window, and routes every uncaught error or rejection to the runtime-error fallback.
 */
export function startMemoryBox(target: Window): MemoryBoxController {
  let stopListening = () => {};
  const controller = createMemoryBoxController({
    clearTimer: (id) => target.clearTimeout(id),
    createPhotoLoader: (options) => createPhotoLoader({ ...options, document: target.document }),
    createView: (onNext) => createDomView(target.document, onNext),
    now: () => target.performance.now(),
    onDestroy: () => stopListening(),
    post: createPoster(target.parent),
    setTimer: (callback, delayMs) => target.setTimeout(callback, delayMs),
  });

  stopListening = listenToParent(target, controller.receive);
  target.addEventListener("error", (event) => controller.fail(event.error));
  target.addEventListener("unhandledrejection", (event) => controller.fail(event.reason));
  return controller;
}

// The artifact only runs framed by a Viewer host; a top-level window has no host to talk to.
if (typeof window !== "undefined" && window.parent !== window) {
  startMemoryBox(window);
}
