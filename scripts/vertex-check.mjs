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

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { createTokenSource, loadServiceAccount } from "../src/backend/vertex-auth.js";
import { DEFAULT_VERTEX_LOCATION, modelsFromEnv } from "../src/backend/providers.js";

function loadDotEnv() {
  if (process.env.VERTEX_PROJECT_ID) return;
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, name, value] = match;
      process.env[name] ??= value.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sin .env */
  }
}

/** Ejecuta gcloud si está instalado; si no, devuelve cadena vacía. */
function gcloud(args) {
  try {
    const output = execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output === "(unset)" ? "" : output;
  } catch {
    return "";
  }
}

loadDotEnv();

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
      "  VERTEX_LOCATION=europe-west4 \\",
      "  VERTEX_SA_KEY_B64=$(base64 -w0 vibedom-vertex.json) \\",
      "  npm run vertex:check",
    ].join("\n"),
  );
  process.exit(1);
}

const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
const base = `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}`;

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

// ---- Modelos publicados ----------------------------------------------------

try {
  const res = await fetch(`${base}/publishers/google/models?pageSize=200`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const published = (data.publisherModels ?? data.models ?? [])
    .map((model) => String(model.name ?? "").split("/").pop())
    .filter((name) => name.includes("gemini"))
    .sort();
  console.log(`modelos Gemini publicados en ${location}: ${published.length}`);
  for (const name of published) console.log(`  · ${name}`);
  console.log("");
} catch (err) {
  console.warn(`⚠ no se pudo listar el catálogo (${err.message}); se prueban igualmente los modelos\n`);
}

// ---- Llamada mínima --------------------------------------------------------

let failures = 0;
for (const model of models) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Responde solo con la palabra ok." }] }],
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) {
      failures += 1;
      console.log(`✖ ${model} → ${res.status} en ${ms} ms: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
      continue;
    }
    const answer = JSON.parse(text)?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    const usage = JSON.parse(text)?.usageMetadata ?? {};
    console.log(
      `✔ ${model} → ${ms} ms · "${answer.trim().slice(0, 40)}" · tokens in=${usage.promptTokenCount ?? "?"} out=${usage.candidatesTokenCount ?? "?"}`,
    );
  } catch (err) {
    failures += 1;
    console.log(`✖ ${model} → ${err.name === "TimeoutError" ? "timeout 30 s" : err.message}`);
  }
}

console.log("");
if (failures) {
  console.error(`${failures} modelo(s) fallaron. Ajusta VERTEX_MODELS antes de desplegar.`);
  process.exit(1);
}
if (credentials) {
  console.log("Todo listo: copia VERTEX_PROJECT_ID, VERTEX_LOCATION y VERTEX_SA_KEY_B64 en Render.");
} else {
  console.log(
    [
      "Modelos y permisos OK.",
      "Para Render falta la service account: el token de tu sesión caduca en 1 h.",
      "  gcloud iam service-accounts keys create vibedom-vertex.json \\",
      "    --iam-account=vibedom-vertex@vibedom.iam.gserviceaccount.com",
      "  base64 -w0 vibedom-vertex.json   # → VERTEX_SA_KEY_B64 en Render",
    ].join("\n"),
  );
}
