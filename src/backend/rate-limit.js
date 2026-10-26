// Limitador en memoria por IP. Suficiente para una demo pública con una sola
// instancia: protege la clave de Gemini de un uso accidental o abusivo.
//
// En Render (y otros proxies) la IP real llega en X-Forwarded-For. Usamos la
// última entrada, que es la que añade el proxy de confianza; las anteriores
// pueden venir falsificadas por el cliente.

const parsedLimit = Number(process.env.SCAN_RATE_LIMIT);
const DEFAULT_LIMIT = Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : 5;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 5000;

export function clientIp(req) {
  const header = req.headers?.["x-forwarded-for"];
  const forwarded = Array.isArray(header) ? header.join(",") : String(header ?? "");
  const last = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return last || req.socket?.remoteAddress || "unknown";
}

export function createRateLimiter({
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now,
} = {}) {
  const buckets = new Map();
  let lastSweep = 0;

  function sweep(timestamp) {
    if (buckets.size < MAX_TRACKED_IPS && timestamp - lastSweep < windowMs) return;
    lastSweep = timestamp;
    for (const [key, bucket] of buckets) {
      if (timestamp - bucket.start >= windowMs) buckets.delete(key);
    }
  }

  return function check(req) {
    if (!limit) return { ok: true, remaining: Infinity, retryAfter: 0 };

    const timestamp = now();
    sweep(timestamp);

    const key = clientIp(req);
    const bucket = buckets.get(key);

    if (!bucket || timestamp - bucket.start >= windowMs) {
      buckets.set(key, { start: timestamp, count: 1 });
      return { ok: true, remaining: limit - 1, retryAfter: 0 };
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.start + windowMs - timestamp) / 1000));
      return { ok: false, remaining: 0, retryAfter };
    }

    return { ok: true, remaining: limit - bucket.count, retryAfter: 0 };
  };
}
