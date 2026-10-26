// Caché en memoria de semillas por URL.
//
// Evita pagar dos veces a Gemini por la misma web (y los 429 de cuota) cuando
// alguien repite un escaneo o comparte la demo. Vive solo en el proceso: no hay
// base de datos ni persistencia, y cada entrada caduca.
//
// SCAN_CACHE_TTL (segundos) controla el TTL; 0 desactiva la caché.

const DEFAULT_TTL_MS = 60 * 60_000;
const DEFAULT_MAX = 500;

function resolveDefaultTtl() {
  const raw = process.env.SCAN_CACHE_TTL;
  if (raw === undefined || raw === "") return DEFAULT_TTL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : DEFAULT_TTL_MS;
}

export const DEFAULT_CACHE_TTL_MS = resolveDefaultTtl();

/** Clave estable: sin hash, sin barra final, host y esquema normalizados. */
export function cacheKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return String(url);
  }
}

export function createScanCache({ ttlMs = DEFAULT_CACHE_TTL_MS, max = DEFAULT_MAX, now = Date.now } = {}) {
  const entries = new Map();
  const enabled = ttlMs > 0 && max > 0;

  return {
    get(key) {
      if (!enabled) return undefined;
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        entries.delete(key);
        return undefined;
      }
      // Reinsertar mantiene el orden de uso (el primero es el más viejo).
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    set(key, value) {
      if (!enabled) return;
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },

    get size() {
      return entries.size;
    },

    get enabled() {
      return enabled;
    },
  };
}
