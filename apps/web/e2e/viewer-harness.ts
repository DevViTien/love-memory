import { expect, type FrameLocator, type Locator, type TestInfo } from "@playwright/test";

export async function captureViewerScreenshot(
  viewer: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await viewer.screenshot({ animations: "disabled", path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

/**
 * Presses the template's in-frame `Tiếp` once the current scene has settled. A scene slides in for
 * 0.5 s (`mb-enter`); a press while it is still moving could miss the button under load, and the
 * scene would then never advance.
 */
export async function pressTemplateNext(frame: FrameLocator): Promise<void> {
  const next = frame.getByRole("button", { name: "Tiếp" });
  await expect(next).toBeEnabled();
  await frame
    .locator("section[data-scene]")
    .evaluate((section) =>
      Promise.all(section.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
  await next.click();
}
