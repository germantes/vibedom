// Baliza de visitas. Una petición al cargar la página, y nada más.
//
// Envía la ruta (sin búsqueda), el idioma, el canal (`ref` o, si no hay,
// `utm_source`) y el dominio del referrer. No usa cookies, localStorage ni
// ningún identificador. Si el navegador pide Do Not Track o Global Privacy
// Control, no se envía. Un backend dormido o caído no puede romper la página.

const PRODUCTION_API = "https://vibedom.onrender.com";
const REF_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** `true` cuando DNT o GPC piden que no se mida la visita. */
export function trackingOptOut(source) {
  if (!source) return false;
  const dnt = source.doNotTrack ?? source.msDoNotTrack;
  if (dnt === "1" || dnt === "yes") return true;
  return source.globalPrivacyControl === true;
}

function sanitizeRef(value) {
  const ref = String(value ?? "").trim().toLowerCase();
  return REF_RE.test(ref) ? ref : "";
}

function referrerHost(referrer) {
  if (!referrer) return "";
  try {
    let host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    if (!host || host.length > 253 || host.includes(":")) return "";
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return "";
    return /^[a-z0-9.-]+$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

/**
 * Cuerpo de la baliza, o `null` si la ruta no es contable. `ref` gana a
 * `utm_source`. El referrer queda reducido al dominio.
 */
export function buildHit({ pathname, lang, search, referrer }) {
  const path = String(pathname ?? "");
  if (path.length < 1 || path.length > 120 || !path.startsWith("/") || path.includes("..")) return null;
  if (!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(path)) return null;

  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const ref = sanitizeRef(params.get("ref")) || sanitizeRef(params.get("utm_source"));
  return {
    path,
    lang: String(lang ?? "").toLowerCase().startsWith("en") ? "en" : "es",
    ref,
    referrer: referrerHost(referrer),
  };
}

/** URL de `POST /api/hit`, o "" si no hay dónde enviarla (p. ej. `file:`). */
export function resolveHitEndpoint({ protocol, hostname, origin, apiMeta }) {
  if (protocol !== "http:" && protocol !== "https:") return "";
  const host = String(hostname ?? "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return `${origin}/api/hit`;
  }

  const raw = String(apiMeta ?? "").trim();
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return `${parsed.origin}/api/hit`;
      }
    } catch {
      // meta inválida: se prueba el origen de la propia página
    }
  }

  if (/(^|\.)(github\.io|vibedom\.dev)$/.test(host)) return `${PRODUCTION_API}/api/hit`;
  return origin ? `${origin}/api/hit` : "";
}

function dispatch(url, body, { beaconImpl, fetchImpl }) {
  try {
    if (typeof beaconImpl === "function") {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (beaconImpl(url, blob)) return true;
    }
  } catch {
    // sendBeacon puede fallar; el fetch de abajo cubre el envío
  }
  if (typeof fetchImpl !== "function") return false;
  try {
    const pending = fetchImpl(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      keepalive: true,
      credentials: "omit",
      mode: "cors",
      cache: "no-store",
    });
    pending?.then?.(
      () => {},
      () => {},
    );
  } catch {
    return false;
  }
  return true;
}

/**
 * Envía la visita una vez. Devuelve `false` si no se envió (opt-out, ruta rara
 * o sin destino). Nunca lanza.
 */
export function sendVisit({
  navigator: nav,
  window: win,
  document: doc,
  location: loc,
  fetchImpl,
  beaconImpl,
} = {}) {
  try {
    if (trackingOptOut(nav) || trackingOptOut(win)) return false;
    const meta = doc?.querySelector?.('meta[name="vibedom-api"]')?.getAttribute?.("content") ?? "";
    const endpoint = resolveHitEndpoint({
      protocol: loc?.protocol,
      hostname: loc?.hostname,
      origin: loc?.origin,
      apiMeta: meta,
    });
    if (!endpoint) return false;
    const hit = buildHit({
      pathname: loc?.pathname,
      lang: doc?.documentElement?.lang,
      search: loc?.search,
      referrer: doc?.referrer,
    });
    if (!hit) return false;
    return dispatch(endpoint, JSON.stringify(hit), {
      beaconImpl: beaconImpl ?? nav?.sendBeacon?.bind?.(nav),
      fetchImpl,
    });
  } catch {
    return false;
  }
}

if (typeof document !== "undefined" && typeof location !== "undefined") {
  try {
    sendVisit({
      navigator,
      window,
      document,
      location,
      fetchImpl: globalThis.fetch?.bind(globalThis),
    });
  } catch {
    // Un fallo del contador no puede romper la página.
  }
}
