// Cambia el dominio público del sitio.
//
//   npm run set-domain -- https://vibedom.dev
//
// Reescribe canonical, og:url, hreflang, sitemap, robots y la documentación, y
// crea el archivo CNAME que GitHub Pages necesita. El dominio debe estar ya
// resolviendo por DNS antes de hacer push: en cuanto entra el CNAME, Pages deja
// de servir la URL de github.io y redirige al dominio nuevo.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OLD = "https://germantes.github.io/vibedom";
const FILES = [
  "index.html",
  "en/index.html",
  "que-suena-mi-web/index.html",
  "en/what-does-my-website-sound-like/index.html",
  "sitemap.xml",
  "robots.txt",
  "README.md",
  "ESTADO_DEL_PROYECTO.md",
];

const arg = process.argv[2];
if (!arg) {
  console.error("Uso: npm run set-domain -- https://tu-dominio.dev");
  process.exit(1);
}

let host;
try {
  const parsed = new URL(arg);
  if (parsed.protocol !== "https:") throw new Error("solo https");
  if (parsed.pathname !== "/" && parsed.pathname !== "") throw new Error("sin ruta");
  host = parsed.hostname;
} catch {
  console.error(`Dominio inválido: ${arg} (se espera https://dominio.tld, sin ruta)`);
  process.exit(1);
}

for (const file of FILES) {
  const path = `${ROOT}${file}`;
  const original = await readFile(path, "utf8");
  if (!original.includes(OLD)) {
    console.warn(`· ${file}: no contenía ${OLD}`);
    continue;
  }
  const next = original.split(OLD).join(`https://${host}`);
  await writeFile(path, next);
  const count = original.split(OLD).length - 1;
  console.log(`✔ ${file} (${count} referencia${count === 1 ? "" : "s"})`);
}

await writeFile(`${ROOT}CNAME`, `${host}\n`);
console.log(`✔ CNAME → ${host}`);
console.log(`\nDominio configurado: https://${host}`);
