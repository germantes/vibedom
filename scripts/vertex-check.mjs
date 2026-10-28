#!/usr/bin/env node
// Comprueba la configuración de Vertex AI antes de tocar producción.
//
//   npm run vertex:check
//
// 1. Canjea el token con la service account.
// 2. Lista los modelos Gemini publicados en la región elegida.
// 3. Hace una llamada mínima a cada modelo de VERTEX_MODELS y dice cuáles
//    responden. Así se detecta un nombre de modelo equivocado antes de
//    desplegar.
//
// No imprime la clave privada ni el token.

import { execFileSync } from "node:child_process";

import { createTokenSource, loadServiceAccount } from "../src/backend/vertex-auth.js";
import { DEFAULT_VERTEX_LOCATION, modelsFromEnv } from "../src/backend/providers.js";
import { loadDotEnv } from "../src/backend/dotenv.js";

/** Ejecuta gcloud si está instalado; si no, devuelve cadena vacía. */
function gcloud(args) {
  try {
    const output = execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output === "(unset)" ? "" : output;
  } catch {
    return "";
  }
}

loadDotEnv(new URL("../.env", import.meta.url));

// El proyecto puede venir de la variable o del proyecto activo de gcloud.
const project = process.env.VERTEX_PROJECT_ID?.trim() || gcloud(["config", "get-value", "project"]);
const location = process.env.VERTEX_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
const models = modelsFromEnv(process.env.VERTEX_MODELS);

const credentials = loadServiceAccount();
let accessToken = process.env.VERTEX_ACCESS_TOKEN?.trim() || null;
let authLabel = credentials ? credentials.clientEmail : accessToken ? "VERTEX_ACCESS_TOKEN" : "";

// Sin service account, se usa el token de la sesión de gcloud. Sirve para
// probar el catálogo y los modelos; para Render sigue haciendo falta la clave.
if (!credentials && !accessToken) {
  accessToken = gcloud(["auth", "print-access-token"]) || null;
  if (accessToken) authLabel = "tu sesión de gcloud (solo para probar)";
}

if (!project || !authLabel) {
  console.error(
    [
      "Faltan credenciales para Vertex AI.",
      "",
      "Opción rápida (con gcloud ya autenticado):",
      "  gcloud auth login",
      "  gcloud config set project vibedom",
      "  gcloud services enable aiplatform.googleapis.com",
      "  npm run vertex:check",
      "",
      "Opción con service account (la que necesita Render):",
      "  VERTEX_PROJECT_ID=vibedom \\",
      "  VERTEX_LOCATION=global \\",
      "  VERTEX_SA_KEY_B64=$(base64 -w0 vibedom-vertex.json) \\",
      "  npm run vertex:check",
    ].join("\n"),
  );
  process.exit(1);
}

const baseFor = (loc) => {
  const host = loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(loc)}`;
};
const base = baseFor(location);

const tokens = createTokenSource({ credentials, accessToken });

console.log(`proyecto: ${project}`);
console.log(`región:   ${location}`);
console.log(`auth:     ${authLabel}`);
console.log(`modelos:  ${models.join(", ")}\n`);

let token;
try {
  token = await tokens.get();
} catch (err) {
  console.error(`✖ No se pudo obtener el token: ${err.message}`);
  process.exit(1);
}
console.log("✔ token de OAuth obtenido\n");

const headers = { Authorization: `Bearer ${token}` };
const jsonHeaders = { ...headers, "Content-Type": "application/json" };

// ---- Catálogo --------------------------------------------------------------

async function listPublished(target) {
  const res = await fetch(`${target}/publishers/google/models?pageSize=1000`, { headers });
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  if (!type.includes("json")) return { ok: false, reason: `respuesta ${type || "sin tipo"}` };
  try {
    const data = JSON.parse(text);
    const names = (data.publisherModels ?? data.models ?? [])
      .map((model) => String(model.name ?? "").split("/").pop())
      .filter(Boolean);
    return { ok: true, names };
  } catch {
    return { ok: false, reason: "JSON ilegible" };
  }
}

let published = null;
for (const loc of [...new Set([location, "global"])]) {
  const catalog = await listPublished(baseFor(loc));
  if (catalog.ok) {
    published = catalog.names.filter((name) => name.includes("gemini")).sort();
    console.log(`modelos Gemini publicados en ${loc}: ${published.length}`);
    for (const name of published) console.log(`  · ${name}`);
    console.log("");
    break;
  }
  console.log(`⚠ catálogo en ${loc}: no disponible (${catalog.reason})`);
}

// ---- Llamada mínima --------------------------------------------------------

async function probe(target, model) {
  const started = Date.now();
  try {
    const res = await fetch(`${target}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Responde solo con la palabra ok." }] }],
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, ms, status: res.status, detail: text.replace(/\s+/g, " ").slice(0, 180) };
    }
    const data = JSON.parse(text);
    const answer = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ?? "";
    return { ok: true, ms, answer: answer.trim().slice(0, 40), usage: data.usageMetadata ?? {} };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, status: 0, detail: err.name === "TimeoutError" ? "timeout 30 s" : err.message };
  }
}

function report(model, result) {
  if (!result.ok) {
    console.log(`✖ ${model} → ${result.status || "error"} en ${result.ms} ms: ${result.detail}`);
    return;
  }
  console.log(
    `✔ ${model} → ${result.ms} ms · "${result.answer}" · tokens in=${result.usage.promptTokenCount ?? "?"} out=${result.usage.candidatesTokenCount ?? "?"}`,
  );
}

const working = [];
for (const model of models) {
  const result = await probe(base, model);
  report(model, result);
  if (result.ok) working.push(model);
}

// Nombres habituales en Vertex, por si la cadena de AI Studio no existe aquí.
const EXTRA_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-flash-latest",
];

if (!working.length) {
  console.log("\nProbando nombres alternativos…");
  const tried = new Set(models);
  for (const model of EXTRA_MODELS) {
    if (tried.has(model)) continue;
    tried.add(model);
    const result = await probe(base, model);
    if (result.ok) {
      report(model, result);
      working.push(model);
    }
  }

  // Los modelos más nuevos suelen vivir solo en el endpoint global.
  if (!working.length && location !== "global") {
    console.log("\nNada en la región; probando el endpoint global…");
    for (const model of [...models, ...EXTRA_MODELS]) {
      if (!tried.has(model)) continue;
      const result = await probe(baseFor("global"), model);
      if (result.ok) {
        report(model, result);
        working.push(`${model} (global)`);
        break;
      }
    }
  }
}

console.log("");
if (working.length) {
  console.log(`Modelos que responden: ${working.join(", ")}`);
  console.log(`Configura VERTEX_MODELS="${working.map((m) => m.replace(" (global)", "")).join(",")}"`);
  if (working.some((m) => m.includes("(global)"))) {
    console.log('Atención: ese modelo solo respondió en `global`; usa VERTEX_LOCATION="global".');
  }
  console.log("Después: copia VERTEX_PROJECT_ID, VERTEX_LOCATION y VERTEX_SA_KEY_B64 en Render.");
  process.exit(0);
}

if (published?.length) {
  console.log("El catálogo sí lista modelos, pero ninguno de los probados respondió.");
  console.log("Prueba a poner en VERTEX_MODELS alguno de los nombres de la lista de arriba.");
}
console.error(
  [
    "Ningún modelo respondió.",
    "Si el catálogo aparece vacío o da 404, habilita el modelo en Model Garden:",
    "  https://console.cloud.google.com/vertex-ai/model-garden",
    "Los modelos preview (gemini-3-*-preview) pueden requerir acceso explícito.",
  ].join("\n"),
);
process.exit(1);
