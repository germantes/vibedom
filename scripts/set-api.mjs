// Declara el backend externo en las cuatro páginas.
//
//   npm run set-api -- https://vibedom-api.onrender.com
//   npm run set-api -- --clear
//
// Escribe el origen en <meta name="vibedom-api"> para que GitHub Pages (u otro
// host estático) pueda escanear contra el servidor Node.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGES = ["index.html", "en/index.html", "playground/index.html", "playground/en/index.html"];
const META = /(<meta name="vibedom-api" content=")([^"]*)(")/;

const arg = process.argv[2];
if (!arg) {
  console.error("Uso: npm run set-api -- https://tu-servicio.onrender.com");
  console.error("     npm run set-api -- --clear");
  process.exit(1);
}

let value = "";
if (arg !== "--clear") {
  let parsed;
  try {
    parsed = new URL(arg);
  } catch {
    console.error(`URL inválida: ${arg}`);
    process.exit(1);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    console.error("El backend debe ser http(s).");
    process.exit(1);
  }
  value = arg.replace(/\/+$/, "");
}

let changed = 0;
for (const page of PAGES) {
  const path = `${ROOT}${page}`;
  const html = await readFile(path, "utf8");
  if (!META.test(html)) {
    console.error(`✖ ${page}: no encuentro <meta name="vibedom-api">`);
    process.exitCode = 1;
    continue;
  }
  const next = html.replace(META, (_, open, _old, close) => `${open}${value}${close}`);
  if (next === html) {
    console.log(`· ${page}: ya estaba así`);
    continue;
  }
  await writeFile(path, next);
  changed += 1;
  console.log(`✔ ${page}`);
}

console.log(
  value
    ? `\nBackend declarado: ${value} (${changed} archivo${changed === 1 ? "" : "s"} actualizado${changed === 1 ? "" : "s"})`
    : `\nBackend externo eliminado (${changed} archivo${changed === 1 ? "" : "s"} actualizado${changed === 1 ? "" : "s"})`,
);
