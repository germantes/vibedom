// Proveedores de IA: Gemini API (API key) o Vertex AI (service account).
//
// Los dos hablan el mismo dialecto (`generateContent` + `responseSchema`), así
// que el traductor solo necesita saber tres cosas de cada proveedor:
//   • la URL del modelo,
//   • las cabeceras de autenticación,
//   • el nombre del campo del system prompt (`system_instruction` vs `systemInstruction`).
//
// `VERTEX_PROJECT_ID` manda: si está definido se usa Vertex AI. Si no, se usa
// la API key de siempre. Sin ninguna de las dos, el servidor compone en local.

import { createTokenSource, loadServiceAccount } from "./vertex-auth.js";

/** El primero es el preferido; el resto solo entra si el anterior falla. */
export const AI_MODELS = Object.freeze(["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash"]);

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Los modelos más nuevos (Gemini 3.x) solo se publican en el endpoint global;
// las regiones europeas pueden devolver 404. Se puede forzar con VERTEX_LOCATION.
export const DEFAULT_VERTEX_LOCATION = "global";

/** Lista de modelos separada por comas, con la de por defecto como respaldo. */
export function modelsFromEnv(raw, fallback = AI_MODELS) {
  const models = String(raw ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length ? models : [...fallback];
}

/** URL REST de un modelo publicado por Google en Vertex AI. */
export function vertexEndpoint({ project, location = DEFAULT_VERTEX_LOCATION, model }) {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

export function createGeminiProvider({ key, models = AI_MODELS, endpoint = GEMINI_ENDPOINT } = {}) {
  return {
    name: "gemini",
    models: [...models],
    systemInstructionField: "system_instruction",
    // En la API key un 404 a veces es throttling con cuerpo vacío; en Vertex
    // significa que el modelo o la URL están mal, así que no se reintenta.
    retryNotFound: true,
    async prepare(model) {
      if (!key) {
        throw new Error("GEMINI_KEY no encontrada: ponla en .env o como variable de entorno");
      }
      return {
        url: `${endpoint}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        headers: {},
      };
    },
    async refresh() {
      return false;
    },
  };
}

export function createVertexProvider({
  project,
  location = DEFAULT_VERTEX_LOCATION,
  models = AI_MODELS,
  env = process.env,
  accessToken = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  if (!project) throw new Error("VERTEX_PROJECT_ID no definido");

  let tokens = null;
  const tokenSource = () => {
    tokens ??= createTokenSource({
      credentials: loadServiceAccount(env),
      accessToken,
      fetchImpl,
      now,
    });
    return tokens;
  };

  return {
    name: "vertex",
    project,
    location,
    models: [...models],
    systemInstructionField: "systemInstruction",
    retryNotFound: false,
    async prepare(model) {
      const token = await tokenSource().get();
      return {
        url: vertexEndpoint({ project, location, model }),
        headers: { Authorization: `Bearer ${token}` },
      };
    },
    /** Tras un 401 se descarta el token cacheado y se reintenta una vez. */
    async refresh() {
      if (accessToken) return false;
      tokenSource().invalidate();
      return true;
    },
  };
}

/** Motor que usará el escaneo, para `/api/health` y la cabecera de origen. */
export function resolveEngine(env = process.env) {
  if (env.VERTEX_PROJECT_ID?.trim()) return "vertex";
  if (env.GEMINI_KEY?.trim()) return "gemini";
  return "local";
}

export function resolveProvider({ env = process.env, key, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (env.VERTEX_PROJECT_ID?.trim()) {
    return createVertexProvider({
      project: env.VERTEX_PROJECT_ID.trim(),
      location: env.VERTEX_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION,
      models: modelsFromEnv(env.VERTEX_MODELS),
      env,
      accessToken: env.VERTEX_ACCESS_TOKEN?.trim() || null,
      fetchImpl,
      now,
    });
  }

  return createGeminiProvider({
    key: key ?? env.GEMINI_KEY?.trim() ?? null,
    models: modelsFromEnv(env.GEMINI_MODELS),
  });
}
