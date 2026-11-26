// E2E de la página de sound tests: las 10 tarjetas cargan estáticas, el
// botón Escuchar trae la semilla JSON (mismo origen) y arranca el motor con
// Tone.js real del CDN, y el enlace del playground lleva la semilla corta.

import { expect, test } from "@playwright/test";

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
});

test.afterEach(async () => {
  expect(pageErrors, "la página no debe lanzar excepciones sin capturar").toEqual([]);
});

test("la página ES muestra las 10 webs con su enlace al playground", async ({ page }) => {
  await page.goto("/sound-tests/");
  const cards = page.locator(".st-card");
  await expect(cards).toHaveCount(10);
  await expect(page.locator(".st-play")).toHaveCount(10);

  const firstShare = page.locator(".st-meta a").first();
  await expect(firstShare).toHaveAttribute("href", /\/playground\/#seed=~[A-Za-z0-9_-]+/);

  // La versión EN replica la vitrina.
  await page.goto("/en/sound-tests/");
  await expect(page.locator(".st-card")).toHaveCount(10);
  await expect(page.locator('.st-play[data-slug="stripe"] .st-play-label')).toHaveText("Play");
});

test("Escuchar reproduce la semilla guardada sin tocar ninguna API de IA", async ({ page }) => {
  const apiCalls = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiCalls.push(request.url());
  });

  await page.goto("/sound-tests/");
  const stripe = page.locator('.st-play[data-slug="stripe"]');
  await stripe.click();
  await expect(stripe).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect(stripe.locator(".st-play-label")).toHaveText("Pausar");

  // Pausar y volver a Escuchar sin errores.
  await stripe.click();
  await expect(stripe).toHaveAttribute("aria-pressed", "false");
  await expect(stripe.locator(".st-play-label")).toHaveText("Escuchar");

  expect(
    apiCalls.filter((url) => !url.includes("/api/ping") && !url.includes("/api/hit")),
    "no se gasta IA",
  ).toEqual([]);
});
