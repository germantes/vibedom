// Aviso de página vista. Sin cookies, sin localStorage y sin scripts de
// terceros. Do Not Track y Global Privacy Control cancelan el envío.
//
// El cuerpo es texto plano (sendBeacon no hace preflight con una cadena) y
// solo lleva ruta, idioma, ref de la lista blanca y el host del referrer.

import { buildCollectPayload, collectEndpoint, trackingOptedOut } from "./analytics-core.js";
import { resolveApiBase } from "./host-mode.js";

function endpoint() {
  const meta = document.querySelector('meta[name="vibedom-api"]');
  const apiBase = resolveApiBase(meta?.getAttribute("content") ?? "");
  return collectEndpoint(location, apiBase).href;
}

/** Envía un evento (`pageview`, `scan`). No lanza. */
export function track(event) {
  try {
    if (typeof document === "undefined") return;
    if (trackingOptedOut(navigator, globalThis)) return;

    const payload = buildCollectPayload({
      event,
      path: location.pathname,
      lang: document.documentElement.lang,
      ref: new URLSearchParams(location.search).get("ref"),
      referrer: document.referrer,
    });
    if (!payload) return;

    const body = JSON.stringify(payload);
    const url = endpoint();
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, body)) return;

    fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      mode: "cors",
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // Medir nunca puede romper la página.
  }
}

if (typeof document !== "undefined") track("pageview");
