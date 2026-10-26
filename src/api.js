// Resolución del backend de escaneo.
//
// - En local (npm start) o en un despliegue full-stack, la API vive en el mismo
//   origen: /api/scan.
// - En GitHub Pages, en el dominio propio o en file: no hay backend. Si la
//   página declara <meta name="vibedom-api" content="https://...">, usamos ese
//   origen externo y el escaneo sigue funcionando; si no, la UI lo explica y no
//   hace peticiones.
//
// La clasificación vive en host-mode.js para poder probarla sin DOM.

import { classifyHost } from "./host-mode.js";

const meta = document.querySelector('meta[name="vibedom-api"]');
const rawBase = meta?.getAttribute("content") ?? "";

const host = classifyHost({
  protocol: location.protocol,
  hostname: location.hostname,
  origin: location.origin,
  rawApiBase: rawBase,
});

const { apiBase, staticHost, externalApi } = host;

if (rawBase.trim() && !apiBase) {
  console.warn("[vibedom] vibedom-api debe ser una URL http(s) válida:", rawBase);
}

export const STATIC_HOST = staticHost;
export const EXTERNAL_API = externalApi;
export const CAN_SCAN = !STATIC_HOST || EXTERNAL_API;

export const API_URL = apiBase
  ? new URL(`${apiBase}/api/scan`)
  : new URL("../api/scan", import.meta.url);
export const HEALTH_URL = apiBase
  ? new URL(`${apiBase}/api/health`)
  : new URL("../api/health", import.meta.url);

/** Despierta el backend externo si el host es estático (Render free duerme). */
export function warmApi() {
  if (!EXTERNAL_API) return;
  fetch(HEALTH_URL, { cache: "no-store" }).catch(() => {});
}
