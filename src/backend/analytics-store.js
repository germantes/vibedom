// Contadores agregados de visitas. Una cifra por día, ruta, ref, dominio de
// procedencia y evento. Nada de IP, user-agent, cookies ni rutas completas.
//
// El visitante único del día, si hace falta contarlo, es un hash HMAC con una
// sal que cambia cada día UTC. No se guarda la IP. En Redis el hash entra en
// un HyperLogLog (no se puede listar); en memoria vive solo en este proceso.
//
// Upstash Redis por REST, el mismo almacén que el ranking. Sin credenciales
// cae a memoria: en Render el disco es efímero y ese modo se pierde al dormir.

import { createHmac, randomBytes } from "node:crypto";

import { parseCollect } from "../analytics-core.js";
import { dayKey } from "./top-store.js";

export const STATS_PREFIX = "vibedom:stats:v1";
export const STATS_UV_PREFIX = "vibedom:stats:uv:v1";

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_TTL_S = 40 * 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REFERRERS = 400;
const MAX_VISITORS_PER_DAY = 20_000;
const MAX_WINDOW_DAYS = 40;

const memorySalts = new Map();

function ephemeralSalt(day) {
  let salt = memorySalts.get(day);
  if (!salt) {
    salt = randomBytes(32);
    memorySalts.set(day, salt);
    if (memorySalts.size > 3) {
      for (const key of memorySalts.keys()) if (key !== day) memorySalts.delete(key);
    }
  }
  return salt;
}

/**
 * Hash diario de una IP. Cambia con el día aunque el secreto sea estable, así
 * no se puede seguir a la misma persona de un día a otro. `null` si no hay IP.
 * El resultado no contiene la IP.
 */
export function visitorHash(ip, day, secret) {
  if (!ip || ip === "unknown") return null;
  const material = String(secret ?? "").trim();
  const key = material
    ? createHmac("sha256", material).update(`vibedom-stats|${day}`).digest()
    : ephemeralSalt(day);
  return createHmac("sha256", key).update(String(ip)).digest("base64url").slice(0, 22);
}

function lastDays(count, now) {
  return Array.from({ length: count }, (_, index) => dayKey(now - index * DAY_MS));
}

function fieldFor(hit) {
  return [hit.event, hit.path, hit.ref, hit.referrer || "-"].join("|");
}

function parseField(field, count) {
  const parts = String(field).split("|");
  if (parts.length !== 4) return null;
  const [event, path, ref, referrer] = parts;
  if (event !== "pageview" && event !== "scan" && event !== "widget") return null;
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    event,
    path,
    ref,
    referrer: referrer === "-" ? "" : referrer,
    count: value,
  };
}

function emptyTotals() {
  return { pageview: 0, scan: 0, widget: 0 };
}

function addCount(bucket, event, count) {
  if (!Object.hasOwn(bucket, event)) return;
  bucket[event] += count;
}

function ranked(map, name) {
  return [...map.entries()]
    .map(([key, counts]) => ({
      [name]: key,
      pageview: counts.pageview,
      scan: counts.scan,
      widget: counts.widget,
      total: counts.pageview + counts.scan + counts.widget,
    }))
    .sort((a, b) => b.total - a.total || String(a[name]).localeCompare(String(b[name])));
}

export function summarize(rows, { days, from, to, uniques }) {
  const totals = emptyTotals();
  const byRef = new Map();
  const byReferrer = new Map();
  const byPath = new Map();

  for (const row of rows) {
    addCount(totals, row.event, row.count);
    const refBucket = byRef.get(row.ref) ?? emptyTotals();
    addCount(refBucket, row.event, row.count);
    byRef.set(row.ref, refBucket);

    const host = row.referrer || "direct";
    const hostBucket = byReferrer.get(host) ?? emptyTotals();
    addCount(hostBucket, row.event, row.count);
    byReferrer.set(host, hostBucket);

    const pathBucket = byPath.get(row.path) ?? emptyTotals();
    addCount(pathBucket, row.event, row.count);
    byPath.set(row.path, pathBucket);
  }

  return {
    days,
    from,
    to,
    totals,
    uniques,
    byRef: ranked(byRef, "ref"),
    byReferrer: ranked(byReferrer, "host"),
    byPath: ranked(byPath, "path"),
  };
}

function pairsFrom(result) {
  if (!result) return [];
  if (Array.isArray(result)) {
    const pairs = [];
    for (let index = 0; index < result.length; index += 2) {
      pairs.push([result[index], result[index + 1]]);
    }
    return pairs;
  }
  if (typeof result === "object") return Object.entries(result);
  return [];
}

/**
 * @param {object} [options]
 * @param {string} [options.restUrl]
 * @param {string} [options.restToken]
 * @param {string} [options.secret] sal del hash diario; si falta, STATS_SALT o STATS_TOKEN
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createAnalyticsStore({
  restUrl = process.env.UPSTASH_REDIS_REST_URL,
  restToken = process.env.UPSTASH_REDIS_REST_TOKEN,
  secret,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
  maxReferrers = DEFAULT_MAX_REFERRERS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = String(restUrl ?? "").trim().replace(/\/+$/, "");
  const token = String(restToken ?? "").trim();
  const configured = Boolean(base && token);

  if (!configured) {
    logger?.warn?.(
      "[stats] sin UPSTASH_REDIS_REST_URL/TOKEN: las visitas viven solo en memoria y se pierden con el proceso",
    );
  }

  const memory = new Map();
  const visitors = new Map();
  const referrers = new Map();

  function saltSecret() {
    if (secret !== undefined && secret !== null) return String(secret);
    return String(process.env.STATS_SALT ?? process.env.STATS_TOKEN ?? "");
  }

  function prune(map) {
    const oldest = dayKey(now() - (MAX_WINDOW_DAYS + 1) * DAY_MS);
    for (const key of map.keys()) if (key < oldest) map.delete(key);
  }

  function boundReferrer(day, referrer) {
    if (!referrer) return "";
    let seen = referrers.get(day);
    if (!seen) {
      seen = new Set();
      referrers.set(day, seen);
      prune(referrers);
    }
    if (seen.has(referrer)) return referrer;
    if (seen.size >= maxReferrers) return "other";
    seen.add(referrer);
    return referrer;
  }

  function rememberVisitor(day, hash) {
    if (!hash) return;
    let seen = visitors.get(day);
    if (!seen) {
      seen = new Set();
      visitors.set(day, seen);
      prune(visitors);
    }
    if (seen.size >= MAX_VISITORS_PER_DAY && !seen.has(hash)) return;
    seen.add(hash);
  }

  function bumpMemory(day, field) {
    let counts = memory.get(day);
    if (!counts) {
      counts = new Map();
      memory.set(day, counts);
      prune(memory);
    }
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }

  function rowsFor(daysBack) {
    const rows = [];
    for (const day of daysBack) {
      const counts = memory.get(day);
      if (!counts) continue;
      for (const [field, count] of counts) {
        const row = parseField(field, count);
        if (row) rows.push(row);
      }
    }
    return rows;
  }

  function uniquesFor(daysBack) {
    let total = 0;
    for (const day of daysBack) total += visitors.get(day)?.size ?? 0;
    return total;
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

  function report(daysBack, rows, uniques) {
    return summarize(rows, {
      days: daysBack.length,
      from: daysBack[daysBack.length - 1],
      to: daysBack[0],
      uniques,
    });
  }

  return {
    /**
     * Suma un evento ya validado. `ip` solo entra en el hash diario y no se
     * escribe en ningún sitio. No lanza: un fallo del almacén no rompe la página.
     */
    async record(input, { ip } = {}) {
      const hit = parseCollect(input);
      if (!hit) return false;

      const day = dayKey(now());
      const referrer = boundReferrer(day, hit.referrer);
      const stored = { ...hit, referrer };
      const hash = visitorHash(ip, day, saltSecret());

      bumpMemory(day, fieldFor(stored));
      rememberVisitor(day, hash);

      if (!configured) return true;

      const commands = [
        ["HINCRBY", `${STATS_PREFIX}:${day}`, fieldFor(stored), "1"],
        ["EXPIRE", `${STATS_PREFIX}:${day}`, String(KEY_TTL_S)],
      ];
      if (hash) {
        commands.push(
          ["PFADD", `${STATS_UV_PREFIX}:${day}`, hash],
          ["EXPIRE", `${STATS_UV_PREFIX}:${day}`, String(KEY_TTL_S)],
        );
      }

      try {
        await runPipeline(commands);
        return true;
      } catch (err) {
        logger?.warn?.(`[stats] no se pudo guardar el agregado: ${err?.message ?? err}`);
        return false;
      }
    },

    /** Totales de los últimos `days` días UTC, incluido hoy. */
    async summary(days) {
      const count = Number(days);
      if (!Number.isInteger(count) || count < 1 || count > MAX_WINDOW_DAYS) {
        throw new RangeError("Ventana inválida");
      }

      const daysBack = lastDays(count, now());
      if (!configured) return report(daysBack, rowsFor(daysBack), uniquesFor(daysBack));

      try {
        const commands = [
          ...daysBack.map((day) => ["HGETALL", `${STATS_PREFIX}:${day}`]),
          ...daysBack.map((day) => ["PFCOUNT", `${STATS_UV_PREFIX}:${day}`]),
        ];
        const results = await runPipeline(commands);
        const rows = [];
        for (let index = 0; index < daysBack.length; index += 1) {
          for (const [field, value] of pairsFrom(results[index])) {
            const row = parseField(field, value);
            if (row) rows.push(row);
          }
        }
        let uniques = 0;
        for (let index = 0; index < daysBack.length; index += 1) {
          const value = Number(results[daysBack.length + index] ?? 0);
          if (Number.isFinite(value) && value > 0) uniques += value;
        }
        return report(daysBack, rows, uniques);
      } catch (err) {
        logger?.warn?.(`[stats] no se pudo leer el agregado: ${err?.message ?? err}`);
        return report(daysBack, rowsFor(daysBack), uniquesFor(daysBack));
      }
    },

    snapshot() {
      return { backend: configured ? "upstash" : "memory", durable: configured };
    },
  };
}
