// Resolución del backend de escaneo.
//
// - En local (npm start) o en un despliegue full-stack, la API vive en el mismo
//   origen: /api/scan.
// - En GitHub Pages (o file:) no hay backend. Si la página declara
//   <meta name="vibedom-api" content="https://...">, usamos ese origen externo
//   y el escaneo sigue funcionando; si no, la UI lo explica y no hace peticiones.

const meta = document.querySelector('meta[name="vibedom-api"]');
const rawBase = (meta?.getAttribute("content") ?? "").trim();
let apiBase = "";

if (rawBase) {
  try {
    const parsed = new URL(rawBase);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      apiBase = rawBase.replace(/\/+$/, "");
    } else {
      console.warn("[vibedom] vibedom-api debe ser http(s):", rawBase);
    }
  } catch {
    console.warn("[vibedom] vibedom-api no es una URL válida:", rawBase);
  }
}

export const STATIC_HOST =
  location.protocol === "file:" || /(^|\.)github\.io$/.test(location.hostname);
export const EXTERNAL_API = Boolean(apiBase);
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
