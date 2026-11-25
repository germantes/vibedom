// Configuración de los tests E2E. El servidor arrancado por Playwright es el
// backend real del repo (landing, playground y /api/ping en localhost:3000);
// los specs no necesitan claves porque los presets son archivos estáticos y
// ninguna prueba ejecuta un escaneo con IA.

import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "node src/backend/server.js",
    cwd: ROOT,
    url: "http://localhost:3000/api/ping",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
