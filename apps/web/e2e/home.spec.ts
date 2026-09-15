import { HealthResponseSchema } from "@love-memory/contracts";
import { expect, test } from "@playwright/test";
import { type Page } from "@playwright/test";

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  return errors;
}

test("shows the product promise and template catalog", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const response = await page.goto("/");

  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  expect(response?.headers()["content-security-policy"]).not.toContain("strict-dynamic");

  await expect(
    page.getByRole("heading", {
      name: "Biến ký ức của hai người thành một món quà biết kể chuyện.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Khám phá template" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hộp ký ức" })).toBeVisible();
  await page.getByRole("link", { name: "Khám phá template" }).click();
  await expect(page).toHaveURL(/\/templates$/);
  expect(browserErrors).toEqual([]);
});

test("applies nonce CSP to the dynamically rendered Studio", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const response = await page.goto("/studio/new?template=memory-box");
  const policy = response?.headers()["content-security-policy"];

  expect(policy).toContain("strict-dynamic");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  await expect(page.getByRole("heading", { name: "Studio · Hộp ký ức" })).toBeVisible();

  const scriptsHaveNonces = await page
    .locator("script")
    .evaluateAll(
      (scripts) => scripts.length > 0 && scripts.every((script) => script.nonce.length > 0),
    );
  expect(scriptsHaveNonces).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("exposes a validated liveness endpoint", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = HealthResponseSchema.parse(await response.json());

  expect(response.ok()).toBe(true);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(body.data).toMatchObject({
    service: "love-memory",
    status: "ok",
    version: "0.1.0",
  });
});

test("isolates, controls, destroys and reloads the template spike", async ({ page, request }) => {
  const browserErrors = captureBrowserErrors(page);
  const response = await page.goto("/studio/spikes");

  expect(response?.headers()["content-security-policy"]).toContain("strict-dynamic");
  const frame = page.getByTitle("Memory Box sandbox spike");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.getByText("Event: READY")).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText("Event: COMPLETE")).toBeVisible();
  await page.getByRole("button", { name: "Destroy", exact: true }).click();
  await expect(page.getByText("Event: DESTROY sent")).toBeVisible();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByText("Event: READY")).toBeVisible();

  const artifactResponse = await request.get("/template-spikes/memory-box");
  expect(artifactResponse.headers()["content-security-policy"]).toContain("connect-src 'none'");
  expect(artifactResponse.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(browserErrors).toEqual([]);
});

test("keeps mutation spike endpoints hidden by default", async ({ request }) => {
  const response = await request.post("/api/spikes/mongodb");

  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("no-store");
});
