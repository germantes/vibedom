// Autenticación con Google Cloud sin dependencias npm.
//
// Vertex AI no acepta una API key: hay que firmar un JWT con la clave privada
// de una service account, canjearlo por un access token de OAuth2 y mandarlo
// en `Authorization: Bearer`. Todo se hace con `node:crypto`.
//
// El token se cachea en memoria hasta poco antes de caducar (1 h), así que una
// instancia de Render hace el canje una vez por hora como mucho.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_SKEW_MS = 60_000;
const TOKEN_TIMEOUT_MS = 10_000;
const TOKEN_TTL_S = 3600;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/** Valida y normaliza el JSON de una service account. */
export function parseServiceAccount(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`La clave de servicio no es JSON válido: ${err.message}`);
  }

  if (data?.type && data.type !== "service_account") {
    throw new Error(`La clave debe ser de tipo "service_account", no "${data.type}"`);
  }
  for (const field of ["client_email", "private_key"]) {
    if (typeof data?.[field] !== "string" || !data[field]) {
      throw new Error(`La clave de servicio no tiene "${field}"`);
    }
  }

  return {
    clientEmail: data.client_email,
    // Al pasar la clave por una variable de entorno a veces llega con los
    // saltos de línea escapados ("\\n"); OpenSSL necesita saltos reales.
    privateKey: data.private_key.replace(/\\n/g, "\n"),
    projectId: data.project_id,
  };
}

/**
 * Busca credenciales en este orden: base64 (cómodo en Render), JSON inline o
 * el fichero de `GOOGLE_APPLICATION_CREDENTIALS` (cómodo en local).
 */
export function loadServiceAccount(env = process.env, readFile = readFileSync) {
  const encoded = env.VERTEX_SA_KEY_B64?.trim();
  if (encoded) return parseServiceAccount(Buffer.from(encoded, "base64").toString("utf8"));

  const inline = env.VERTEX_SA_KEY_JSON?.trim();
  if (inline) return parseServiceAccount(inline);

  const file = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (file) {
    try {
      return parseServiceAccount(readFile(file, "utf8"));
    } catch (err) {
      throw new Error(`No se pudo leer GOOGLE_APPLICATION_CREDENTIALS (${file}): ${err.message}`);
    }
  }

  return null;
}

/** Firma el JWT RS256 que Google canjea por un access token. */
export function signJwt({
  clientEmail,
  privateKey,
  scope = CLOUD_PLATFORM_SCOPE,
  audience = TOKEN_URL,
  now = Date.now,
  ttlSeconds = TOKEN_TTL_S,
}) {
  const issuedAt = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope,
      aud: audience,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

/**
 * Fuente de access tokens con caché. Devuelve el mismo token a todas las
 * llamadas concurrentes: si llegan diez escaneos a la vez, solo se canjea una
 * vez. `invalidate()` fuerza el canje siguiente tras un 401.
 */
export function createTokenSource({
  credentials = null,
  accessToken = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  tokenUrl = TOKEN_URL,
  timeoutMs = TOKEN_TIMEOUT_MS,
} = {}) {
  let cached = null;
  let pending = null;

  const isFresh = (entry) => Boolean(entry) && entry.expiresAt - TOKEN_SKEW_MS > now();

  // Acepta tanto el JSON crudo de Google como la forma normalizada.
  const creds = credentials
    ? {
        clientEmail: credentials.clientEmail ?? credentials.client_email,
        privateKey: String(credentials.privateKey ?? credentials.private_key ?? "").replace(/\\n/g, "\n"),
      }
    : null;

  async function exchange() {
    if (!creds?.clientEmail || !creds?.privateKey) {
      throw new Error(
        "Vertex AI sin credenciales: define VERTEX_SA_KEY_B64 (recomendado) o VERTEX_ACCESS_TOKEN",
      );
    }

    const assertion = signJwt({
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
      audience: tokenUrl,
      now,
    });

    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OAuth de Google ${res.status}: ${text.replace(/\s+/g, " ").trim().slice(0, 200)}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`OAuth de Google devolvió una respuesta ilegible: ${err.message}`);
    }
    if (!data?.access_token) throw new Error("OAuth de Google no devolvió access_token");

    cached = {
      token: data.access_token,
      expiresAt: now() + (Number(data.expires_in) || TOKEN_TTL_S) * 1000,
    };
    return cached.token;
  }

  return {
    async get() {
      if (accessToken) return accessToken;
      if (isFresh(cached)) return cached.token;
      if (!pending) {
        pending = exchange().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
    invalidate() {
      cached = null;
    },
    get hasCachedToken() {
      return isFresh(cached);
    },
  };
}
