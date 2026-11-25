// E2E del playground: enlace compartido (#seed), copiar al portapapeles,
// exportar/importar la Semilla Sonora y aviso de enlace corrupto. Ninguna
// prueba arranca audio ni llama a /api/scan.

import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CYBERPUNK = JSON.parse(readFileSync(join(ROOT, "presets/cyberpunk.json"), "utf8"));

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
});

test.afterEach(async () => {
  expect(pageErrors, "la página no debe lanzar excepciones sin capturar").toEqual([]);
});

async function loadPreset(page, id) {
  await page.goto("/playground/");
  await page.click(`[data-preset="${id}"]`);
  await expect(page.locator("#controls")).toBeVisible();
}

test("mover el BPM a 100 sincroniza el #seed y el enlace restaura el valor sin llamar a /api/scan", async ({
  browser,
}) => {
  const page = await browser.newPage();
  await loadPreset(page, "cyberpunk");

  await page.fill("#ctl-bpm", "100");
  await expect(page.locator("#ctl-bpm-value")).toHaveText(/100/);
  await page.waitForFunction(() => /(?:^#|&)seed=/.test(location.hash), null, { timeout: 10_000 });

  const sharedUrl = page.url();
  expect(sharedUrl, "la URL debe llevar la semilla en el fragmento").toMatch(/#seed=/);

  // "Otra pestaña": contexto limpio que espía cualquier petición al backend.
  const context = await browser.newContext();
  const scanCalls = [];
  const restored = await context.newPage();
  restored.on("request", (request) => {
    if (request.url().includes("/api/scan")) scanCalls.push(request.url());
  });
  await restored.goto(sharedUrl);

  await expect(restored.locator("#ctl-bpm")).toHaveValue("100");
  await expect(restored.locator("#vibe")).toContainText("Cyberpunk");
  expect(scanCalls, "restaurar un enlace no puede gastar un análisis").toEqual([]);
  await context.close();
});

test("Copiar enlace deja la URL con semilla en el portapapeles y cambia el texto del botón", async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  // El acortador llama al origen del <meta vibedom-api> (producción): se
  // intercepta para que el E2E no dependa de ella ni escriba en su almacén.
  await context.route("**/api/share", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "http://localhost:3000/s/testido", id: "testido" }),
    }),
  );
  const page = await context.newPage();
  await loadPreset(page, "cyberpunk");

  await expect(page.locator("#share-seed")).toBeEnabled();
  await page.click("#share-seed");
  await expect(page.locator("#share-seed")).toHaveText("Enlace copiado");

  // El enlace copiado es el corto: un ID de 7 caracteres bajo /s/.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toMatch(/\/s\/[A-Za-z0-9]{7}$/);
  await context.close();
});

test("un enlace compartido corrupto carga el preset por defecto y explica el fallo", async ({ page }) => {
  await page.goto("/playground/#seed=~esto-no-es-una-semilla");
  await expect(page.locator("#controls")).toBeVisible();
  await expect(page.locator("#status")).toHaveText(
    "El enlace compartido no era válido. Hemos cargado un preset.",
  );
  await expect(page.locator("#vibe")).toContainText("Cyberpunk");
});

test("Descargar JSON baja vibedom-neon-grid.example.json con la semilla activa", async ({
  page,
}) => {
  await loadPreset(page, "cyberpunk");

  await expect(page.locator("#export-seed")).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-seed"),
  ]);

  expect(download.suggestedFilename()).toBe("vibedom-neon-grid.example.json");
  const target = join(tmpdir(), download.suggestedFilename());
  await download.saveAs(target);

  const exported = JSON.parse(readFileSync(target, "utf8"));
  expect(exported.metadata.detectedVibe).toBe(CYBERPUNK.metadata.detectedVibe);
  expect(exported.musicalParams.bpm).toBe(CYBERPUNK.musicalParams.bpm);
});

test("Importar JSON restaura la semilla y pide pulsar Reproducir, sin autoplay", async ({ page }) => {
  await page.goto("/playground/");
  const toggle = page.locator("#toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.setInputFiles("#import-file", join(ROOT, "presets/cyberpunk.json"));

  await expect(page.locator("#status")).toHaveText("Semilla importada. Pulsa Reproducir.");
  await expect(page.locator("#vibe")).toContainText("Cyberpunk");
  await expect(page.locator("#controls")).toBeVisible();
  await expect(toggle, "importar no debe arrancar el audio").toHaveAttribute("aria-pressed", "false");
});

test("un archivo sin semilla válida avisa y no cambia la semilla activa", async ({ page }) => {
  await loadPreset(page, "editorial");
  await expect(page.locator("#vibe")).toContainText("Editorial");

  const corrupt = join(tmpdir(), "vibedom-corrupto.json");
  writeFileSync(corrupt, JSON.stringify({ metadata: "una cadena", musicalParams: {} }));
  await page.setInputFiles("#import-file", corrupt);

  await expect(page.locator("#status")).toHaveText(
    "El archivo no contiene una Semilla Sonora válida.",
  );
  await expect(page.locator("#vibe"), "el estado previo debe quedar intacto").toContainText("Editorial");
});
