// Clasificación del host donde vive la página.
//
// Una misma carpeta HTML se sirve de dos formas:
//   - full-stack (Render): los estáticos y /api/* comparten origen;
//   - estática (GitHub Pages, dominio propio, file:): no hay backend y se usa
//     el origen declarado en <meta name="vibedom-api">.
//
// La regla no depende de una lista de dominios: si la página declara un backend
// en otro origen, es estática. La lista cubre el caso sin meta, donde solo hay
// que avisar al usuario de que el escaneo no está disponible.

const STATIC_HOSTNAME = /(^|\.)(github\.io|vibedom\.dev)$/;

/** Normaliza el contenido de vibedom-api; devuelve "" si no es http(s). */
export function resolveApiBase(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? value.replace(/\/+$/, "")
      : "";
  } catch {
    return "";
  }
}

/**
 * @param {{ protocol: string, hostname: string, origin: string, rawApiBase?: string }} context
 * @returns {{ apiBase: string, apiOrigin: string, staticHost: boolean, externalApi: boolean }}
 */
export function classifyHost({ protocol, hostname, origin, rawApiBase = "" }) {
  const apiBase = resolveApiBase(rawApiBase);
  const apiOrigin = apiBase ? new URL(apiBase).origin : "";
  const staticHost =
    protocol === "file:" ||
    STATIC_HOSTNAME.test(hostname) ||
    (apiOrigin !== "" && apiOrigin !== origin);

  return { apiBase, apiOrigin, staticHost, externalApi: apiBase !== "" };
}
