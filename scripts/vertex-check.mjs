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

loadDotEnv();

const project = process.env.VERTEX_PROJECT_ID?.trim();
const location = process.env.VERTEX_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
const models = modelsFromEnv(process.env.VERTEX_MODELS);

if (!project) {
  console.error(
    [
      "Falta VERTEX_PROJECT_ID.",
      "",
      "Para probarlo en local:",
      "  VERTEX_PROJECT_ID=vibedom \\",
      "  VERTEX_LOCATION=europe-west4 \\",
      "  VERTEX_SA_KEY_B64=$(base64 -w0 clave.json) \\",
      "  npm run vertex:check",
    ].join("\n"),
  );
  process.exit(1);
}

const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
const base = `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}`;

const credentials = loadServiceAccount();
const tokens = createTokenSource({
  credentials,
  accessToken: process.env.VERTEX_ACCESS_TOKEN?.trim() || null,
});

console.log(`proyecto: ${project}`);
console.log(`región:   ${location}`);
console.log(`auth:     ${credentials ? credentials.clientEmail : "VERTEX_ACCESS_TOKEN"}`);
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
console.log("Todo listo: copia VERTEX_PROJECT_ID, VERTEX_LOCATION y VERTEX_SA_KEY_B64 en Render.");
