// Contador de visitas agregado y anónimo.
//
// Una fila es un total del día UTC: ruta de vibedom, canal (`ref` o
// `utm_source`) y dominio del referrer. No hay IP, ni hash de IP, ni
// identificador, ni cadena de búsqueda. La IP solo la usa el limitador del
// servidor, en memoria y durante un minuto; este módulo no la recibe.
//
// El almacén es el mismo Upstash Redis (API REST) que el ranking y los
// enlaces cortos. El disco del plan gratuito de Render es efímero: se pierde
// al dormir o reiniciar el servicio, así que no escribimos ningún fichero.
// Sin credenciales, los totales viven en memoria y desaparecen con el proceso;
// `/api/health` lo indica.

import { dayKey } from "./top-store.js";

export const HIT_PREFIX = "vibedom:hits:v1";
export const REF_DIRECT = "direct";
export const REFERRER_NONE = "none";
export const MAX_STATS_DAYS = 32;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_TTL_S = 40 * 24 * 60 * 60;
const MAX_FIELDS_PER_DAY = 2000;
const DEFAULT_TIMEOUT_MS = 5_000;
const FIELD_SEP = "\t";

const PATH_RE = /^\/(?:[A-Za-z0-9._~-]+\/?)*$/;
const REF_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function lastDays(count, now) {
  return Array.from({ length: count }, (_, index) => dayKey(now - index * DAY_MS));
}

function keyFor(day) {
  return `${HIT_PREFIX}:${day}`;
}

/** Ruta de una página nuestra: sin búsqueda, sin `..` y acotada. */
export function normalizePath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path.length < 1 || path.length > 120) return null;
  if (!PATH_RE.test(path)) return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 6) return null;
  if (segments.some((part) => part === "." || part === ".." || part.length > 80)) return null;
  return path;
}

/** Canal de marketing. Vacío significa visita directa. Un valor raro se rechaza. */
export function normalizeRef(value) {
  if (value == null || value === "") return REF_DIRECT;
  if (typeof value !== "string") return null;
  const ref = value.trim().toLowerCase();
  if (!ref) return REF_DIRECT;
  return REF_RE.test(ref) ? ref : null;
}

function isIpHost(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * Solo el dominio de procedencia. Una URL completa se reduce al host; una IP
 * se descarta (no se almacena ningún dato de red).
 */
export function normalizeReferrerHost(value) {
  if (value == null || value === "") return REFERRER_NONE;
  if (typeof value !== "string") return null;
  let host = value.trim().toLowerCase();
  if (!host) return REFERRER_NONE;
  if (host.length > 300) return null;

  if (host.includes("://") || host.includes("/") || host.includes("?") || host.includes("#")) {
    try {
      host = new URL(host.includes("://") ? host : `http://${host}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  host = host.replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.length > 253 || isIpHost(host)) return REFERRER_NONE;
  return HOST_RE.test(host) ? host : null;
}

/** El idioma solo valida la baliza; la ruta (`/` frente a `/en/`) ya lo distingue. */
export function normalizeLang(value) {
  if (typeof value !== "string") return null;
  const lang = value.trim().toLowerCase();
  if (lang === "es" || lang === "en") return lang;
  return null;
}

/** `null` si el cuerpo no es una visita contable. Nunca copia campos de más. */
export function normalizeHit(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const path = normalizePath(body.path);
  const ref = normalizeRef(body.ref);
  const referrer = normalizeReferrerHost(body.referrer);
  const lang = normalizeLang(body.lang);
  if (!path || !ref || !referrer || !lang) return null;
  return { path, ref, referrer, lang };
}

/** Entero de 1 a 32, o el valor por defecto. `null` si el parámetro es inválido. */
export function clampDays(value, fallback = 7) {
  if (value == null || value === "") return fallback;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_STATS_DAYS) return null;
  return days;
}

function fieldFor(hit) {
  return `${hit.path}${FIELD_SEP}${hit.ref}${FIELD_SEP}${hit.referrer}`;
}

function parseField(field) {
  const parts = String(field).split(FIELD_SEP);
  if (parts.length !== 3) return null;
  const [path, ref, referrer] = parts;
  if (!normalizePath(path) || !normalizeRef(ref) || !normalizeReferrerHost(referrer)) return null;
  if (normalizeRef(ref) !== ref || normalizeReferrerHost(referrer) !== referrer) return null;
  return { path, ref, referrer };
}

function parseHash(result) {
  const counts = new Map();
  const add = (field, value) => {
    const parsed = parseField(field);
    const count = Number(value);
    if (!parsed || !Number.isFinite(count) || count <= 0) return;
    counts.set(String(field), count);
  };

  if (Array.isArray(result)) {
    for (let index = 0; index < result.length; index += 2) add(result[index], result[index + 1]);
    return counts;
  }
  if (result && typeof result === "object") {
    for (const [field, value] of Object.entries(result)) add(field, value);
  }
  return counts;
}

function rank(map, key) {
  return [...map.entries()]
    .map(([name, count]) => ({ [key]: name, count }))
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
}

function summarize(dayMaps, daysList) {
  const rows = [];
  const byRef = new Map();
  const byPath = new Map();
  const byReferrer = new Map();
  let total = 0;

  const add = (map, name, count) => map.set(name, (map.get(name) ?? 0) + count);

  daysList.forEach((date, index) => {
    for (const [field, count] of dayMaps[index]) {
      const parsed = parseField(field);
      if (!parsed) continue;
      total += count;
      rows.push({ date, path: parsed.path, ref: parsed.ref, referrer: parsed.referrer, count });
      add(byRef, parsed.ref, count);
      add(byPath, parsed.path, count);
      add(byReferrer, parsed.referrer, count);
    }
  });

  rows.sort(
    (a, b) => b.date.localeCompare(a.date) || b.count - a.count || a.path.localeCompare(b.path) || a.ref.localeCompare(b.ref),
  );

  return {
    from: daysList[daysList.length - 1] ?? null,
    to: daysList[0] ?? null,
    total,
    byRef: rank(byRef, "ref"),
    byPath: rank(byPath, "path"),
    byReferrer: rank(byReferrer, "host"),
    rows,
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.restUrl]
 * @param {string} [options.restToken]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 */
export function createHitStore({
  restUrl = process.env.UPSTASH_REDIS_REST_URL,
  restToken = process.env.UPSTASH_REDIS_REST_TOKEN,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxFields = MAX_FIELDS_PER_DAY,
} = {}) {
  const base = String(restUrl ?? "").trim().replace(/\/+$/, "");
  const token = String(restToken ?? "").trim();
  const configured = Boolean(base && token);
  const memory = new Map();
  let capWarned = false;

  if (!configured) {
    logger?.warn?.(
      "[hits] sin UPSTASH_REDIS_REST_URL/TOKEN: las visitas viven solo en memoria y se reinician con el proceso",
    );
  }

  function prune() {
    const oldest = dayKey(now() - 40 * DAY_MS);
    for (const key of memory.keys()) if (key < oldest) memory.delete(key);
  }

  function bumpMemory(day, field) {
    let counts = memory.get(day);
    if (!counts) {
      counts = new Map();
      memory.set(day, counts);
    }
    if (!counts.has(field) && counts.size >= maxFields) {
      if (!capWarned) {
        capWarned = true;
        logger?.warn?.("[hits] tope de combinaciones diarias alcanzado; las nuevas no se cuentan");
      }
      return false;
    }
    counts.set(field, (counts.get(field) ?? 0) + 1);
    return true;
  }

  async function runPipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);

    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error("Upstash devolvió una respuesta ilegible");
    }
    if (!Array.isArray(body)) throw new Error("Upstash devolvió una respuesta inesperada");

    const failed = body.find((entry) => entry?.error);
    if (failed) throw new Error(String(failed.error));
    return body.map((entry) => entry?.result);
  }

  return {
    /**
     * Suma una visita ya normalizada. No lanza: un fallo del almacén no puede
     * romper la página que envió la baliza.
     */
    async record(hit) {
      const normalized = normalizeHit(hit);
      if (!normalized) return false;

      const day = dayKey(now());
      prune();
      const field = fieldFor(normalized);
      if (!bumpMemory(day, field)) return false;
      if (!configured) return true;

      try {
        await runPipeline([
          ["HINCRBY", keyFor(day), field, "1"],
          ["EXPIRE", keyFor(day), String(KEY_TTL_S)],
        ]);
        return true;
      } catch (err) {
        logger?.warn?.(`[hits] no se pudo guardar el total del ${day}: ${err?.message ?? err}`);
        return false;
      }
    },

    /** Totales del periodo. Si Upstash falla, usa lo contado en este proceso. */
    async stats({ days = 7 } = {}) {
      const span = clampDays(days);
      if (!span) throw new RangeError(`Periodo inválido: ${days}`);

      const daysList = lastDays(span, now());
      let dayMaps;
      if (configured) {
        try {
          const results = await runPipeline(daysList.map((day) => ["HGETALL", keyFor(day)]));
          dayMaps = results.map((result, index) => {
            const parsed = parseHash(result);
            const local = memory.get(daysList[index]);
            // Si la escritura falló, Redis responde vacío y el total de este
            // proceso es la única copia. Si Redis tiene datos, manda él.
            if (parsed.size === 0 && local?.size) return local;
            return parsed;
          });
        } catch (err) {
          logger?.warn?.(`[hits] no se pudieron leer las visitas: ${err?.message ?? err}`);
          dayMaps = daysList.map((day) => memory.get(day) ?? new Map());
        }
      } else {
        dayMaps = daysList.map((day) => memory.get(day) ?? new Map());
      }

      return { days: span, ...summarize(dayMaps, daysList) };
    },

    /** Estado para `/api/health`; nunca expone credenciales. */
    snapshot() {
      return { backend: configured ? "upstash" : "memory", durable: configured };
    },
  };
}
