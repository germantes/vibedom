// Ranking público de webs escaneadas.
//
// Guarda una única cosa por escaneo: el dominio (sin ruta ni query) y el día
// UTC. Nunca guarda la IP, el HTML ni la semilla. La IP solo se usa, hasheada
// y en memoria, para no contar dos veces al mismo visitante en el mismo día.
//
// El almacén es Upstash Redis por su API REST: sin dependencias npm, gratis y
// durable. Si faltan las credenciales, cae a memoria para desarrollo; en ese
// modo el ranking se reinicia con el proceso y `/api/health` lo indica.

import { createHash, randomUUID } from "node:crypto";

export const TOP_PREFIX = "vibedom:top:v1";
export const PERIODS = Object.freeze({ today: 1, week: 7, month: 30 });

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_TTL_S = 32 * 24 * 60 * 60;
const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_VISITORS_PER_DAY = 5_000;

/** Dominio normalizado: minúsculas, sin `www.` y sin punto final. */
export function normalizeHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  let host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.length > 253 || !host.includes(".")) return null;
  return host;
}

/** Día UTC en formato `YYYY-MM-DD`; es la unidad de los contadores. */
export function dayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function lastDays(count, now) {
  return Array.from({ length: count }, (_, index) => dayKey(now - index * DAY_MS));
}

function keyFor(day) {
  return `${TOP_PREFIX}:${day}`;
}

/**
 * @param {object} [options]
 * @param {string} [options.restUrl] URL REST de Upstash.
 * @param {string} [options.restToken] token REST de Upstash.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 */
export function createTopStore({
  restUrl = process.env.UPSTASH_REDIS_REST_URL,
  restToken = process.env.UPSTASH_REDIS_REST_TOKEN,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
  maxItems = DEFAULT_MAX_ITEMS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = String(restUrl ?? "").trim().replace(/\/+$/, "");
  const token = String(restToken ?? "").trim();
  const configured = Boolean(base && token);
  const durable = configured;

  if (!configured) {
    logger?.warn?.(
      "[top] sin UPSTASH_REDIS_REST_URL/TOKEN: el ranking vive solo en memoria y se reinicia con el proceso",
    );
  }

  // Contadores de respaldo (modo memoria) y vistos para deduplicar.
  const memory = new Map();
  const seen = new Map();
  const cache = new Map();

  function bumpMemory(day, host) {
    let counts = memory.get(day);
    if (!counts) {
      counts = new Map();
      memory.set(day, counts);
    }
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  function memoryTop(days) {
    const totals = new Map();
    for (const day of lastDays(days, now())) {
      const counts = memory.get(day);
      if (!counts) continue;
      for (const [host, count] of counts) {
        totals.set(host, (totals.get(host) ?? 0) + count);
      }
    }
    return sortItems([...totals].map(([host, count]) => ({ host, count })));
  }

  function sortItems(items) {
    return items
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
      .slice(0, maxItems);
  }

  /** Marca al visitante como contado. Devuelve `true` si ya estaba. */
  function alreadyCounted(ip, host, day) {
    if (!ip || ip === "unknown") return false;

    let visitors = seen.get(day);
    if (!visitors) {
      visitors = new Set();
      seen.set(day, visitors);
      // Solo hacen falta el día actual y el anterior; el resto se descarta.
      const oldest = dayKey(now() - 2 * DAY_MS);
      for (const key of seen.keys()) if (key < oldest) seen.delete(key);
    }

    if (visitors.size >= MAX_VISITORS_PER_DAY) return false;

    const digest = createHash("sha256").update(`${day}|${ip}|${host}`).digest("base64url").slice(0, 22);
    if (visitors.has(digest)) return true;
    visitors.add(digest);
    return false;
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

  async function fetchTop(days) {
    const daysBack = lastDays(days, now());
    const keys = daysBack.map(keyFor);
    if (keys.length === 0) return [];

    const temporary = `${TOP_PREFIX}:tmp:${randomUUID()}`;
    const results = await runPipeline([
      ["ZUNIONSTORE", temporary, String(keys.length), ...keys],
      ["EXPIRE", temporary, "60"],
      ["ZREVRANGE", temporary, "0", String(maxItems - 1), "WITHSCORES"],
      ["DEL", temporary],
    ]);

    const range = results[2];
    if (!Array.isArray(range)) return [];

    const items = [];
    for (let index = 0; index < range.length; index += 2) {
      const host = String(range[index]);
      const count = Number(range[index + 1]);
      if (host && Number.isFinite(count)) items.push({ host, count });
    }
    return sortItems(items);
  }

  return {
    /** Suma un escaneo. No lanza: un fallo del ranking no puede romper el escaneo. */
    async record(url, { ip } = {}) {
      const host = normalizeHost(url);
      if (!host) return false;

      const day = dayKey(now());
      if (alreadyCounted(ip, host, day)) return false;

      bumpMemory(day, host);
      cache.clear();

      if (!configured) return true;

      try {
        await runPipeline([
          ["ZINCRBY", keyFor(day), "1", host],
          ["EXPIRE", keyFor(day), String(KEY_TTL_S)],
        ]);
        return true;
      } catch (err) {
        logger?.warn?.(`[top] no se pudo guardar ${host}: ${err?.message ?? err}`);
        return false;
      }
    },

    /** Top del periodo, ordenado por escaneos y después por dominio. */
    async top(period = "month") {
      const days = PERIODS[period];
      if (!days) throw new RangeError(`Periodo inválido: ${period}`);

      const cacheKey = `${period}:${maxItems}`;
      const cached = cache.get(cacheKey);
      if (cached && now() - cached.at < cacheTtlMs) return cached.items;

      let items;
      if (configured) {
        try {
          items = await fetchTop(days);
        } catch (err) {
          logger?.warn?.(`[top] no se pudo leer el ranking: ${err?.message ?? err}`);
          // Si el almacén falla, al menos mostramos lo contado en este proceso
          // o la última copia buena que tengamos.
          items = memoryTop(days);
          if (items.length === 0 && cached) items = cached.items;
        }
      } else {
        items = memoryTop(days);
      }

      if (items.length > 0 || !cached) {
        cache.set(cacheKey, { at: now(), items });
      }
      return items;
    },

    /** Estado para `/api/health`; nunca expone credenciales. */
    snapshot() {
      return { backend: durable ? "upstash" : "memory", durable };
    },
  };
}
