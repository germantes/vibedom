// Carga de `.env` sin dependencias.
//
// Solo se usa al arrancar el servidor como proceso principal y en los scripts,
// nunca al importar el módulo: así los tests no heredan credenciales locales.
// No pisa variables que ya estén definidas en el entorno.

import { readFileSync } from "node:fs";

export function loadDotEnv(url) {
  let raw;
  try {
    raw = readFileSync(url, "utf8");
  } catch {
    return false;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name, value] = match;
    process.env[name] ??= value.replace(/^(['"])(.*)\1$/, "$2");
  }

  return true;
}
