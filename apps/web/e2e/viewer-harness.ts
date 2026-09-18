import { type Locator, type TestInfo } from "@playwright/test";

export async function captureViewerScreenshot(
  viewer: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await viewer.screenshot({ animations: "disabled", path });
  await testInfo.attach(name, { contentType: "image/png", path });
}
