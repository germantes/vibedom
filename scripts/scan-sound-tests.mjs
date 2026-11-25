// Genera las semillas de la página «Sound tests»: escanea webs conocidas en
// el idioma pedido contra un servidor local arrancado en el propio proceso
// (carga .env solo) y guarda cada semilla en sound-tests/<slug>.<lang>.json.
//
//   node scripts/scan-sound-tests.mjs es
//   node scripts/scan-sound-tests.mjs en
//
// Las semillas quedan estáticas en el repo: la página no gasta IA por visita.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "../src/backend/server.js";
// El servidor NO carga .env al importarse (solo como proceso principal):
// los scripts tienen que cargarlo a mano para que coja las credenciales.
import { loadDotEnv } from "../src/backend/dotenv.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(new URL("../.env", import.meta.url));

// Webs conocidas con estéticas variadas: fintech nítida, minimalismo premium,
// editorial denso, brutalismo deportivo, streaming oscuro... El orden es el
// de la página.
const SITES = [
  { url: "https://stripe.com", slug: "stripe" },
  { url: "https://www.apple.com", slug: "apple" },
  { url: "https://en.wikipedia.org", slug: "wikipedia" },
  { url: "https://www.nike.com", slug: "nike" },
  { url: "https://open.spotify.com", slug: "spotify" },
  { url: "https://www.airbnb.com", slug: "airbnb" },
  { url: "https://www.figma.com", slug: "figma" },
  { url: "https://linear.app", slug: "linear" },
  { url: "https://vercel.com", slug: "vercel" },
  { url: "https://github.com", slug: "github" },
];

const lang = String(process.argv[2] ?? "es");
if (!["es", "en"].includes(lang)) {
  console.error("Uso: node scripts/scan-sound-tests.mjs <es|en> [slug...]");
  process.exit(1);
}

// Con slugs como argumento extra solo se (re)escanean esas webs.
const only = process.argv.slice(3).filter(Boolean);
const sites = only.length ? SITES.filter((site) => only.includes(site.slug)) : SITES;

const outDir = join(ROOT, "sound-tests");
await mkdir(outDir, { recursive: true });

const server = await startServer({ port: 0 });
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const failures = [];
const fallbacks = [];

const ATTEMPTS = Number(process.env.SOUND_TESTS_ATTEMPTS ?? 3);

async function scanSite(base, url, lang) {
  const res = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, lang }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 160)}`);
  }
  return res.json();
}

function isAiSeed(seed) {
  // La semilla local de reserva es válida pero genérica: para la vitrina
  // queremos siempre la de la IA; si cae el modelo, se reintenta la web.
  return seed?.metadata?.source !== "local";
}

for (const site of sites) {
  const started = Date.now();
  let seed = null;
  let lastError = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      seed = await scanSite(base, site.url, lang);
      if (isAiSeed(seed)) break;
      lastError = new Error("semilla local sin IA");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (!seed) {
    console.error(`FAIL ${site.slug}: ${lastError?.message}`);
    failures.push(site.slug);
    continue;
  }
  if (!isAiSeed(seed)) {
    console.error(`FAIL ${site.slug}: sigue la semilla local tras ${ATTEMPTS} intentos`);
    fallbacks.push(site.slug);
    continue;
  }

  const file = join(outDir, `${site.slug}.${lang}.json`);
  await writeFile(file, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(
    `ok   ${site.slug}.${lang}.json  (${((Date.now() - started) / 1000).toFixed(1)}s)  vibe: ${seed?.metadata?.detectedVibe ?? "?"}`,
  );
}

await new Promise((resolve) => server.close(resolve));

if (failures.length) {
  console.error(`\n${failures.length} escaneos fallidos: ${failures.join(", ")}`);
  process.exit(1);
}
if (fallbacks.length) {
  console.error(`\n${fallbacks.length} cayeron a la semilla local sin IA: ${fallbacks.join(", ")} (reintentar)`);
  console.error(`Quedan escritas: revisar antes de publicar.`);
  process.exit(1);
}
console.log(`\n${sites.length} semillas guardadas en ${outDir}`);
