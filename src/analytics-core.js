// Contrato de la medición propia. Lo usan el navegador y el servidor para
// que un valor solo se cuente si ambos lo aceptarían.
//
// Nada de esto identifica a una persona: rutas conocidas, un ref de una lista
// corta, el idioma y, como mucho, el dominio de procedencia.

export const REF_CODES = Object.freeze(["x", "hn", "reddit", "devto", "linkedin", "ph"]);
export const COLLECT_EVENTS = Object.freeze(["pageview", "scan", "widget"]);

/** Rutas reales del sitio, más `/embed` para la carga del widget. */
export const COLLECT_PATHS = Object.freeze([
  "/",
  "/en/",
  "/que-suena-mi-web/",
  "/en/what-does-my-website-sound-like/",
  "/sound-tests/",
  "/en/sound-tests/",
  "/playground/",
  "/playground/en/",
  "/widget/",
  "/en/widget/",
  "/privacidad/",
  "/en/privacy/",
  "/embed",
]);

const REF_SET = new Set(["direct", ...REF_CODES]);
const PATH_SET = new Set(COLLECT_PATHS);
const EVENT_SET = new Set(COLLECT_EVENTS);

/** `true` si el navegador pide que no se mida (DNT o Global Privacy Control). */
export function trackingOptedOut(nav, globalObj) {
  const dnt = nav?.doNotTrack ?? globalObj?.doNotTrack;
  if (dnt === "1" || dnt === "yes") return true;
  return nav?.globalPrivacyControl === true;
}

/** Código de campaña conocido, o `direct` si falta o no está en la lista. */
export function normalizeRef(value) {
  const ref = String(value ?? "").trim().toLowerCase();
  return REF_SET.has(ref) ? ref : "direct";
}

export function normalizeLang(value) {
  const lang = String(value ?? "").trim().toLowerCase();
  if (lang === "es" || lang === "en") return lang;
  return null;
}

/**
 * Ruta del sitio, sin query ni hash. Acepta la forma con o sin barra final
 * y `index.html`. Devuelve `null` si no es una ruta publicada.
 */
export function normalizePath(value) {
  let path = String(value ?? "").trim();
  if (!path || path.length > 160) return null;

  const hash = path.indexOf("#");
  if (hash >= 0) path = path.slice(0, hash);
  const query = path.indexOf("?");
  if (query >= 0) path = path.slice(0, query);
  if (!path.startsWith("/") || path.includes("\\") || path.includes("//") || path.includes("..")) {
    return null;
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }

  if (!path.startsWith("/") || path.includes("\\") || path.includes("//") || path.includes("..")) {
    return null;
  }
  if (!/^\/[a-z0-9./-]*$/.test(path)) return null;
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length) || "/";
  if (path.length > 1 && !path.endsWith("/") && path !== "/embed" && PATH_SET.has(`${path}/`)) {
    path = `${path}/`;
  }
  return PATH_SET.has(path) ? path : null;
}

/**
 * Solo el host público de una URL o de un dominio ya recortado.
 * Sin esquema, usuario, ruta, query, IP ni localhost.
 */
export function referrerHost(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 500) return "";

  let host = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//")) {
    let parsed;
    try {
      parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    } catch {
      return "";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    host = parsed.hostname;
  } else if (/[/?#]/.test(raw)) {
    try {
      host = new URL(`https://${raw}`).hostname;
    } catch {
      return "";
    }
  }

  host = host.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.length > 253 || !host.includes(".")) return "";
  if (!/^[a-z0-9.-]+$/.test(host)) return "";
  if (host.startsWith(".") || host.includes("..")) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "";
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return "";
  return host;
}

/**
 * Normaliza un cuerpo de medición. `null` si el evento, la ruta o el idioma
 * no son aceptables. Un `ref` o un referrer desconocidos no tiran el evento:
 * pasan a `direct` o a vacío.
 */
export function parseCollect(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const event = body.event;
  if (!EVENT_SET.has(event)) return null;

  const lang = normalizeLang(body.lang);
  if (!lang) return null;

  const path = normalizePath(event === "widget" ? "/embed" : body.path);
  if (!path) return null;
  if (event !== "widget" && path === "/embed") return null;

  return {
    event,
    path,
    lang,
    ref: normalizeRef(body.ref),
    referrer: referrerHost(body.referrer),
  };
}

/** Arma el cuerpo que envía el navegador a partir de la página actual. */
export function buildCollectPayload({ event, path, lang, ref, referrer } = {}) {
  return parseCollect({
    event,
    path: event === "widget" ? "/embed" : path,
    lang,
    ref,
    referrer,
  });
}

/**
 * En local el aviso se queda en el mismo origen (los E2E no deben escribir
 * en producción). En el sitio estático se usa el backend declarado.
 */
export function collectEndpoint(locationLike, apiBase) {
  const hostname = String(locationLike?.hostname ?? "");
  const origin = String(locationLike?.origin ?? "");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return new URL("/api/collect", origin);
  }
  if (apiBase) return new URL("/api/collect", apiBase);
  return new URL("/api/collect", origin);
}
