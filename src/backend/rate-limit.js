// Limitador en memoria por IP. Suficiente para una demo pública con una sola
// instancia: protege la clave de Gemini de un uso accidental o abusivo.
//
// Producción es Cloudflare delante de Render. La última entrada de
// X-Forwarded-For la añade el proxy de Render y es la IP del edge de
// Cloudflare: si la usáramos, visitantes distintos compartirían la cuota
// (5/min y 8/día). CF-Connecting-IP y True-Client-IP las escribe el edge con
// el cliente real. Sin ellas (local, o un solo proxy) se usa la última XFF,
// que es la que añade el proxy de confianza; las anteriores puede haberlas
// puesto el cliente. Al final, la dirección del socket.

const parsedLimit = Number(process.env.SCAN_RATE_LIMIT);
const DEFAULT_LIMIT = Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : 5;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 5000;

function headerTokens(req, name) {
  const header = req.headers?.[name];
  const raw = Array.isArray(header) ? header.join(",") : String(header ?? "");
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** IPv4 o IPv6, acotada. Una cabecera gigante no puede ser clave del mapa. */
function usableIp(value) {
  if (!value || value.length > 64) return "";
  return /^[0-9a-fA-F:.]+$/.test(value) ? value : "";
}

export function clientIp(req) {
  for (const name of ["cf-connecting-ip", "true-client-ip"]) {
    const ip = usableIp(headerTokens(req, name)[0]);
    if (ip) return ip;
  }
  const forwarded = usableIp(headerTokens(req, "x-forwarded-for").at(-1));
  if (forwarded) return forwarded;
  return req.socket?.remoteAddress || "unknown";
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
