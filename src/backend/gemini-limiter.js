// Limitador global de llamadas a Gemini.
//
// La cuota gratuita es por proyecto, no por IP: dos visitantes distintos
// comparten el mismo cupo. Por eso, además del rate limit por IP, las llamadas
// reales a Gemini se serializan y se separan por un intervalo mínimo.
//
// Si la cola se llena o la espera supera `maxWaitMs`, se lanza un error con
// código RATE_LIMITED y un `retryAfter` en segundos. El servidor lo traduce a
// un 429 amable en vez de martillear la API y acabar en un 502 técnico.

const DEFAULT_MIN_INTERVAL_MS = 8_000;
const DEFAULT_MAX_WAIT_MS = 25_000;
const DEFAULT_QUEUE_LIMIT = 10;

function envInt(name, fallback, { min = 0 } = {}) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min ? Math.floor(raw) : fallback;
}

export class GeminiLimiterError extends Error {
  constructor(message, { retryAfter = 30, cause } = {}) {
    super(message, { cause });
    this.name = "GeminiLimiterError";
    this.code = "RATE_LIMITED";
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}

export function createGeminiLimiter({
  minIntervalMs = envInt("GEMINI_MIN_INTERVAL_MS", DEFAULT_MIN_INTERVAL_MS),
  maxWaitMs = envInt("GEMINI_MAX_WAIT_MS", DEFAULT_MAX_WAIT_MS),
  queueLimit = envInt("GEMINI_QUEUE_LIMIT", DEFAULT_QUEUE_LIMIT, { min: 1 }),
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let tail = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  let waiting = 0;

  const secondsUntil = (timestamp) => Math.max(1, Math.ceil((timestamp - now()) / 1000));

  function cooldown(seconds) {
    const ms = Math.max(0, Number(seconds) || 0) * 1000;
    cooldownUntil = Math.max(cooldownUntil, now() + ms);
  }

  function retryAfter() {
    return secondsUntil(Math.max(nextStart, cooldownUntil));
  }

  async function run(task) {
    if (waiting >= queueLimit) {
      throw new GeminiLimiterError("La cola de análisis está llena", { retryAfter: retryAfter() });
    }

    const queuedAt = now();
    waiting += 1;
    let release;
    const previous = tail;
    tail = new Promise((resolve) => {
      release = resolve;
    });

    try {
      await previous;

      let startAt = Math.max(now(), nextStart, cooldownUntil);
      if (startAt - queuedAt > maxWaitMs) {
        throw new GeminiLimiterError("La espera para llamar a Gemini es demasiado larga", {
          retryAfter: secondsUntil(startAt),
        });
      }

      let delay = startAt - now();
      if (delay > 0) await sleep(delay);

      // Un 429 de una llamada anterior puede haber ampliado el enfriamiento
      // mientras esta esperaba su turno.
      startAt = Math.max(now(), cooldownUntil);
      if (startAt - queuedAt > maxWaitMs) {
        throw new GeminiLimiterError("La espera para llamar a Gemini es demasiado larga", {
          retryAfter: secondsUntil(startAt),
        });
      }
      delay = startAt - now();
      if (delay > 0) await sleep(delay);

      nextStart = now() + minIntervalMs;
      return await task();
    } finally {
      waiting -= 1;
      release();
    }
  }

  return {
    run,
    cooldown,
    retryAfter,
    get pending() {
      return waiting;
    },
    get cooldownSeconds() {
      return Math.max(0, Math.ceil((cooldownUntil - now()) / 1000));
    },
  };
}
