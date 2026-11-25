// E2E del historial local de la landing: sección oculta sin escaneos, chip
// visible al recargar con datos guardados y re-escucha sin gasto de IA.
// El localStorage se siembra directamente (clave vibedom:history): así la
// prueba no depende del backend ni de claves.

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EDITORIAL = JSON.parse(readFileSync(join(ROOT, "presets/editorial.json"), "utf8"));

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
});

test.afterEach(async () => {
  expect(pageErrors, "la página no debe lanzar excepciones sin capturar").toEqual([]);
});

test("sin escaneos previos la sección de historial está oculta y no hay enlace que copiar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#history")).toBeHidden();
  await expect(page.locator(".history-chip")).toHaveCount(0);
  // Con la demo por defecto (preset) el botón de compartir no aparece.
  await expect(page.locator("#demo-share")).toBeHidden();
});

test("con historial guardado aparece el chip y reproducirlo cambia la demo sin gastar análisis", async ({
  browser,
}) => {
  const entry = {
    url: "https://maison-editorial.example/diseno",
    host: "maison-editorial.example",
    vibe: EDITORIAL.metadata.detectedVibe,
    at: Date.now(),
    seed: EDITORIAL,
  };

  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(
    ({ entryJson }) => window.localStorage.setItem("vibedom:history", entryJson),
    { entryJson: JSON.stringify([entry]) },
  );

  const page = await context.newPage();
  const scanCalls = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/scan")) scanCalls.push(request.url());
  });

  await page.goto("/");
  await expect(page.locator("#history")).toBeVisible();
  const chip = page.locator(".history-chip");
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("maison-editorial.example");
  await expect(chip).toContainText("Editorial");

  // La demo arranca con el preset por defecto (Cyberpunk); el chip debe
  // sustituirlo por la semilla guardada.
  await expect(page.locator("#demo-vibe")).toContainText("Cyberpunk");
  await chip.click();
  await expect(page.locator("#demo-vibe")).toContainText("Editorial");
  await expect(page.locator("#demo-source")).toBeVisible();

  // Con una semilla propia cargada, «Copiar enlace» aparece y deja en el
  // portapapeles el /s/<token> del origen declarado.
  const share = page.locator("#demo-share");
  await expect(share).toBeVisible();
  await share.click();
  await expect(share).toHaveText("Enlace copiado");
  const apiOrigin = await page.getAttribute('meta[name="vibedom-api"]', "content");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.startsWith(`${apiOrigin}/s/~`)).toBe(true);

  expect(scanCalls, "re-escuchar el historial no gasta un análisis").toEqual([]);
  await context.close();
});
