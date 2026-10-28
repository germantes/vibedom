// Traductor sinestésico: señales estéticas → IA → Semilla Sonora.
//
// El motor es Vertex AI (`VERTEX_PROJECT_ID`) o la API key de Gemini
// (`GEMINI_KEY`); el resto del flujo es común. La IA devuelve 503/404
// esporádicos y su latencia es muy variable, así que la llamada se hace con:
//   • timeout por intento y deadline total,
//   • reintentos con backoff exponencial + jitter,
//   • cadena de modelos de respaldo (si uno falla, se prueba el siguiente),
//   • thinkingLevel "low" (el schema ya guía la respuesta; pensar de más solo añade latencia).

import { readFileSync } from "node:fs";
import { normalizeSeed } from "../engine/seed.js";
import { AI_MODELS, createGeminiProvider, modelsFromEnv, resolveProvider } from "./providers.js";

/** @deprecated usa AI_MODELS; se mantiene por compatibilidad con imports antiguos. */
export const GEMINI_MODELS = AI_MODELS;

const DEFAULT_ATTEMPTS_PER_MODEL = 2;
const DEFAULT_RETRY_DELAY_MS = 700;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 20_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 50_000;

/** Idiomas admitidos para la copia generada. Cualquier otro valor cae en español. */
const OUTPUT_LANGUAGES = {
  es: "español",
  en: "inglés",
};

export function resolveLang(value) {
  return value === "en" ? "en" : "es";
}

// 404: la API a veces responde 404 con cuerpo vacío por throttling (no porque falte el modelo).
// 429 no está aquí a propósito: la cuota es global y reintentar empeora el problema.
const RETRYABLE_STATUS = new Set([404, 408, 500, 502, 503, 504]);

const DEFAULT_RATE_LIMIT_RETRY_S = 30;

export class GeminiError extends Error {
  constructor(message, { status, retryable = false, code, retryAfter, cause } = {}) {
    super(message, { cause });
    this.name = "GeminiError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function loadKey() {
  if (process.env.GEMINI_KEY) return process.env.GEMINI_KEY;
  try {
    const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    const m = env.match(/^GEMINI_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* no .env */
  }
  throw new GeminiError("GEMINI_KEY no encontrada: ponla en .env o como variable de entorno");
}

/** Vertex AI si hay proyecto configurado; si no, la API key de siempre. */
function defaultProvider({ key } = {}) {
  if (process.env.VERTEX_PROJECT_ID?.trim()) return resolveProvider();
  return createGeminiProvider({
    key: key ?? loadKey(),
    models: modelsFromEnv(process.env.GEMINI_MODELS),
  });
}

// ---- Prompt ----------------------------------------------------------------

const SYSTEM_PROMPT = `Eres un Director Musical Sinestésico. Recibes el análisis estético de una página web y produces una "Semilla Sonora" JSON: parámetros para un motor de síntesis procedural Tone.js que genera un soundscape ambiental infinito.

REGLAS DE TRADUCCIÓN:

Colores y modo:
• Fondo oscuro (isDark) → escalas menores, frigias o dóricas; BPM bajo (50-80); filtro cerrado (200-800 Hz)
• Fondo claro → escalas mayores o lidias; BPM moderado (60-100); filtro abierto (1000-4000 Hz)
• Colores saturados/neón → más chorus y reverb; ondas sawtooth/square
• Colores apagados/pastel → menos efectos; ondas sine/triangle

Tipografía:
• Monospace → texturas analógicas: sawtooth o square, filtro más cerrado
• Serif → calidez: sine o triangle, reverb larga, tempo lento
• Sans-serif → limpieza: triangle o sine, efectos moderados
• Display/decorativa → carácter: cualquier onda, densidad de arpegio alta

Dinámica:
• Tiene animaciones/transiciones → BPM más alto (+10-15), arpegio más denso (0.4-0.7)
• Sin movimiento → BPM bajo, arpegio disperso (0.1-0.3) o desactivado
• Contenido denso → más capas activas
• Mucho espacio en blanco → minimalismo: densidad baja, reverb alta

Interactividad:
• Si el filtro está cerrado → scrollTarget "filterFreq" con multiplier alto (2-4): el scroll abre el sonido
• Si reverb domina → scrollTarget "reverbWet"
• Si arpegio es protagonista → scrollTarget "arpDensity"

El campo explanation debe ser UNA frase concisa explicando la conexión entre la estética detectada y la elección musical. detectedVibe es un resumen de 3-5 palabras de la identidad visual.

uiTheme debe reflejar los colores reales de la web escaneada (fondo, acento y texto).`;

/**
 * El sitio analizado puede estar en cualquier idioma: la copia visible
 * (detectedVibe y explanation) debe seguir el idioma de la página que pidió el
 * escaneo, no el del sitio escaneado.
 */
function systemPrompt(lang) {
  const language = OUTPUT_LANGUAGES[resolveLang(lang)];
  return `${SYSTEM_PROMPT}

IDIOMA DE SALIDA:
• Escribe "detectedVibe" y "explanation" en ${language}, aunque el sitio analizado esté en otro idioma.
• No traduzcas los valores técnicos ni los nombres de escala/onda: solo la copia visible.`;
}

// ---- Schema para structured output (formato Gemini) ------------------------

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    metadata: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING" },
        detectedVibe: { type: "STRING", description: "3-5 palabras: la identidad visual" },
        explanation: { type: "STRING", description: "Una frase conectando estética y música" },
      },
      required: ["url", "detectedVibe", "explanation"],
    },
    uiTheme: {
      type: "OBJECT",
      properties: {
        backgroundColor: { type: "STRING", description: "Color hex #RRGGBB del fondo de la web" },
        accentColor: { type: "STRING", description: "Color hex #RRGGBB del acento/enlace de la web" },
        textColor: { type: "STRING", description: "Color hex #RRGGBB del texto principal" },
        fontFamily: { type: "STRING", enum: ["serif", "sans-serif", "monospace", "display"] },
      },
      required: ["backgroundColor", "accentColor", "textColor", "fontFamily"],
    },
    musicalParams: {
      type: "OBJECT",
      properties: {
        bpm: { type: "INTEGER", description: "40-140" },
        rootNote: { type: "STRING", enum: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] },
        scale: { type: "STRING", enum: ["major", "minor", "dorian", "phrygian", "lydian", "pentatonic"] },
        octave: { type: "INTEGER", description: "2-5" },
      },
      required: ["bpm", "rootNote", "scale", "octave"],
    },
    synthConfig: {
      type: "OBJECT",
      properties: {
        pad: {
          type: "OBJECT",
          properties: {
            waveform: { type: "STRING", enum: ["sine", "triangle", "sawtooth", "square"] },
            attack: { type: "NUMBER", description: "Segundos, 0.5-8" },
            release: { type: "NUMBER", description: "Segundos, 1-12" },
            filterFreq: { type: "NUMBER", description: "Hz, 200-6000" },
          },
          required: ["waveform", "attack", "release", "filterFreq"],
        },
        arp: {
          type: "OBJECT",
          properties: {
            enabled: { type: "BOOLEAN" },
            waveform: { type: "STRING", enum: ["sine", "triangle", "sawtooth", "square"] },
            density: { type: "NUMBER", description: "0-1, probabilidad por paso" },
            delayWet: { type: "NUMBER", description: "0-1" },
          },
          required: ["enabled", "waveform", "density", "delayWet"],
        },
        effects: {
          type: "OBJECT",
          properties: {
            reverbDecay: { type: "NUMBER", description: "Segundos, 1-15" },
            reverbWet: { type: "NUMBER", description: "0-1" },
            chorusDepth: { type: "NUMBER", description: "0-1" },
          },
          required: ["reverbDecay", "reverbWet", "chorusDepth"],
        },
        interactivity: {
          type: "OBJECT",
          properties: {
            scrollTarget: { type: "STRING", enum: ["filterFreq", "reverbWet", "delayWet", "arpDensity"] },
            scrollMultiplier: { type: "NUMBER", description: "1-5" },
            hoverNoteTrigger: { type: "BOOLEAN" },
          },
          required: ["scrollTarget", "scrollMultiplier", "hoverNoteTrigger"],
        },
      },
      required: ["pad", "arp", "effects", "interactivity"],
    },
  },
  required: ["metadata", "uiTheme", "musicalParams", "synthConfig"],
};

// ---- Parseo ----------------------------------------------------------------

function parseJson(raw) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new GeminiError(`Gemini devolvió JSON inválido: ${err.message}`, { retryable: true, cause: err });
  }
}

// ---- Llamada a Gemini ------------------------------------------------------

function abortReason(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("Petición cancelada");
  err.name = "AbortError";
  return err;
}

/**
 * Gemini indica cuándo se puede reintentar de dos formas: la cabecera
 * `Retry-After` o `error.details[].retryDelay` (RetryInfo). Si no viene nada,
 * asumimos 30 s: suficiente para que la ventana de cuota se recupere.
 */
function parseRetryAfter(res, bodyText) {
  const header = res.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }

  try {
    const data = JSON.parse(bodyText);
    for (const detail of data?.error?.details ?? []) {
      const raw = detail?.retryDelay ?? detail?.retry_delay;
      const match = typeof raw === "string" ? raw.match(/^(\d+(?:\.\d+)?)s$/) : null;
      if (match) return Math.max(1, Math.ceil(Number(match[1])));
    }
  } catch {
    /* el cuerpo no era JSON */
  }

  return DEFAULT_RATE_LIMIT_RETRY_S;
}

function providerHint(provider, status) {
  if (provider.name !== "vertex") return "";
  if (status === 403) return " (¿API Vertex AI habilitada y la service account con roles/aiplatform.user?)";
  if (status === 404) return " (¿modelo disponible en esa región? revisa VERTEX_MODELS)";
  return "";
}

async function requestModel({ provider, model, body, fetchImpl, signal, timeoutMs, logger }) {
  const label = provider.name === "vertex" ? "Vertex" : "Gemini";
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const send = (target) =>
    fetchImpl(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...target.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

  try {
    let target;
    try {
      target = await provider.prepare(model);
    } catch (err) {
      throw new GeminiError(`${label}: ${err.message}`, {
        retryable: false,
        code: "PROVIDER_CONFIG",
        cause: err,
      });
    }
    // `prepare` es asíncrono (Vertex canjea el token): si el cliente canceló
    // mientras tanto, no llegamos a lanzar la petición.
    if (signal?.aborted) throw abortReason(signal);

    let res = await send(target);

    // Un token caducado o revocado devuelve 401: se descarta y se reintenta
    // una sola vez con uno nuevo.
    if (res.status === 401 && (await provider.refresh?.())) {
      if (signal?.aborted) throw abortReason(signal);
      target = await provider.prepare(model);
      res = await send(target);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = text.replace(/\s+/g, " ").trim().slice(0, 240);
      const rateLimited = res.status === 429;
      const retryable =
        !rateLimited &&
        (provider.retryNotFound
          ? RETRYABLE_STATUS.has(res.status)
          : res.status !== 404 && RETRYABLE_STATUS.has(res.status));
      throw new GeminiError(`${label} ${res.status}: ${detail || "sin detalle"}${providerHint(provider, res.status)}`, {
        status: res.status,
        retryable,
        code: rateLimited ? "RATE_LIMITED" : undefined,
        retryAfter: rateLimited ? parseRetryAfter(res, text) : undefined,
      });
    }

    const data = await res.json();
    const usage = data.usageMetadata;
    if (usage) {
      logger?.log?.(
        `[${provider.name}] ${model} · tokens in=${usage.promptTokenCount ?? "?"} out=${usage.candidatesTokenCount ?? "?"} total=${usage.totalTokenCount ?? "?"}`,
      );
    }
    const raw = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("");
    if (!raw) throw new GeminiError(`${label} no devolvió contenido`, { retryable: true });
    return raw;
  } catch (err) {
    if (timedOut) {
      throw new GeminiError(`${label} no respondió en ${Math.round(timeoutMs / 1000)} s`, { retryable: true, cause: err });
    }
    if (signal?.aborted) throw abortReason(signal);
    if (err instanceof GeminiError) throw err;
    throw new GeminiError(`Error de red con ${label}: ${err.message}`, { retryable: true, cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Convierte señales del scraper en una Semilla Sonora validada.
 * Opciones pensadas para tests (fetchImpl, sleep, modelos, timeouts, signal).
 */
export async function translate(signals, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attemptsPerModel = DEFAULT_ATTEMPTS_PER_MODEL,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    signal,
    lang = "es",
    limiter,
    logger = console,
  } = options;

  const provider = options.provider ?? defaultProvider(options);
  const models = options.models ?? provider.models;
  const deadline = Date.now() + totalTimeoutMs;
  const failures = [];
  const schedule = limiter?.run ? (task) => limiter.run(task) : (task) => task();

  const body = {
    [provider.systemInstructionField]: { parts: [{ text: systemPrompt(lang) }] },
    contents: [
      {
        parts: [{ text: `Analiza esta web y genera la Semilla Sonora:\n\n${JSON.stringify(signals, null, 2)}` }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.8,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: "low" },
    },
  };

  for (const model of models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      if (signal?.aborted) throw abortReason(signal);

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new GeminiError(
          `Tiempo total de traducción agotado (${Math.round(totalTimeoutMs / 1000)} s). ${failures.at(-1) ?? ""}`.trim(),
          { retryable: false },
        );
      }

      const timeoutMs = Math.min(attemptTimeoutMs, remaining);
      try {
        const raw = await schedule(async () => {
          try {
            return await requestModel({ provider, model, body, fetchImpl, signal, timeoutMs, logger });
          } catch (err) {
            // Un 429 afecta a todo el proyecto: enfriamos la cola global antes
            // de liberar el turno para que la siguiente petición no lo repita.
            if (err instanceof GeminiError && err.code === "RATE_LIMITED") {
              limiter?.cooldown?.(err.retryAfter ?? DEFAULT_RATE_LIMIT_RETRY_S);
            }
            throw err;
          }
        });
        const seed = parseJson(raw);
        try {
          return normalizeSeed(seed);
        } catch (err) {
          throw new GeminiError(`Semilla inválida de ${model}: ${err.message}`, { retryable: true, cause: err });
        }
      } catch (err) {
        if (signal?.aborted) throw abortReason(signal);

        if (err?.code === "RATE_LIMITED") {
          const rateLimited =
            err instanceof GeminiError
              ? err
              : new GeminiError(err.message, {
                  status: 429,
                  retryable: false,
                  code: "RATE_LIMITED",
                  retryAfter: err.retryAfter,
                  cause: err,
                });
          logger.warn(`[${provider.name}] cuota agotada; reintentar en ${rateLimited.retryAfter ?? DEFAULT_RATE_LIMIT_RETRY_S} s`);
          throw rateLimited;
        }

        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${model}#${attempt}: ${message}`);
        logger.warn(`[${provider.name}] ${model} intento ${attempt} falló: ${message}`);

        const retryable = err instanceof GeminiError ? err.retryable : false;
        if (!retryable || attempt === attemptsPerModel) break;
        const delay = retryDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
      }
    }
  }

  throw new GeminiError(
    `No se pudo traducir la web tras varios intentos. ${failures.slice(-3).join(" | ")}`.trim(),
    { retryable: false, code: "ANALYSIS_FAILED" },
  );
}
