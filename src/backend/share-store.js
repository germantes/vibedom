// Enlaces compartidos cortos: la semilla viaja como ID aleatorio en vez de
// token de ~200 caracteres. El token se guarda en Upstash Redis por su API
// REST con caducidad (EX): la clave desaparece sola, sin limpieza.
//
// Privacidad aquí, como en el ranking: se guarda el token de la semilla que
// el propio usuario acaba de generar pulsando «Copiar enlace», nunca IPs ni
// historial. La versión por defecto —el token largo en el fragmento `#seed`—
// sigue sin tocar el servidor.
//
// Sin credenciales Upstash cae a memoria (desarrollo): los enlaces solo viven
// mientras el proceso. Un fallo del almacén nunca rompe compartir: devolver
// `null` hace que el cliente use el enlace largo.

const KEY_PREFIX = "vibedom:share:v1";
const DEFAULT_TTL_S = 30 * 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ID_LENGTH = 7;
const CREATE_ATTEMPTS = 3;

// Sin I, l, 1, O, 0 ni o: los enlaces se leen a mano y a veces en voz alta.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function randomId(length) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => ALPHABET[value % ALPHABET.length]).join("");
}

/**
 * @param {object} [options]
 * @param {string} [options.restUrl] URL REST de Upstash.
 * @param {string} [options.restToken] token REST de Upstash.
 * @param {number} [options.ttlS] caducidad del enlace en segundos.
 * @param {number} [options.idLength] longitud del ID (7 → ~2e12 valores).
 * @param {typeof fetch} [options.fetchImpl]
 * @param {object} [options.logger]
 */
export function createShareStore({
  restUrl = process.env.UPSTASH_REDIS_REST_URL,
  restToken = process.env.UPSTASH_REDIS_REST_TOKEN,
  ttlS = DEFAULT_TTL_S,
  idLength = DEFAULT_ID_LENGTH,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const base = String(restUrl ?? "").trim().replace(/\/+$/, "");
  const token = String(restToken ?? "").trim();
  const configured = Boolean(base && token);

  if (!configured) {
    logger?.warn?.("[share] sin UPSTASH_REDIS_REST_URL/TOKEN: los enlaces cortos viven solo en memoria");
  }

  // Respaldo en memoria para desarrollo sin credenciales.
  const memory = new Map();
  const keyFor = (id) => `${KEY_PREFIX}:${id}`;

  /** Un comando Redis por petición (forma JSON-array de la API REST). */
  async function command(args) {
    const res = await fetchImpl(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const body = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      throw new Error(String(body.error));
    }
    return "result" in body ? body.result : null;
  }

  async function get(key) {
    if (!configured) return memory.get(key) ?? null;
    return command(["GET", key]);
  }

  /**
   * Guarda un token bajo un ID nuevo. Devuelve el ID o `null` si el almacén
   * no está disponible (el cliente cae al enlace largo); nunca lanza.
   */
  async function create(tokenValue) {
    const value = String(tokenValue ?? "");
    if (!value) return null;

    if (!configured) {
      let id = randomId(idLength);
      while (memory.has(keyFor(id))) id = randomId(idLength);
      memory.set(keyFor(id), value);
      return id;
    }

    try {
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
        const id = randomId(idLength);
        const stored = await command(["SET", keyFor(id), value, "NX", "EX", String(ttlS)]);
        if (stored === "OK") return id;
      }
      return null;
    } catch (err) {
      logger?.warn?.(`[share] no se pudo guardar el enlace: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Recupera el token de un ID, o `null` si no existe (caducó o nunca
   * existió). Nunca lanza: la vista previa muestra su página de error.
   */
  async function resolve(id) {
    const key = keyFor(String(id ?? ""));
    try {
      const value = await get(key);
      return typeof value === "string" && value ? value : null;
    } catch (err) {
      logger?.warn?.(`[share] no se pudo leer el enlace: ${err?.message ?? err}`);
      return null;
    }
  }

  return {
    create,
    resolve,
    /** Estado para diagnósticos; nunca expone credenciales. */
    snapshot() {
      return { backend: configured ? "upstash" : "memory", durable: configured, ttlS };
    },
  };
}

/** Forma de un ID corto generado arriba, para distinguirlo de un token. */
export const SHORT_ID_SOURCE = new RegExp(`^[${ALPHABET}]{${DEFAULT_ID_LENGTH}}$`);
