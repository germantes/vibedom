// Traza persistente y mínima para diagnosticar caídas del proceso.
//
// En Render los logs solo se ven desde el panel; si el proceso muere a mitad de
// un escaneo necesitamos saber hasta dónde llegó. Escribimos pocas líneas en
// /tmp (se borra en cada despliegue, sobrevive a un reinicio del proceso) y las
// exponemos en /api/diagnostics.
//
// Nunca lanza: una traza jamás debe tumbar un escaneo.

import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE = join(tmpdir(), "vibedom-events.log");
const MAX_BYTES = 48 * 1024;

export function recordEvent(message) {
  try {
    let size = 0;
    try {
      size = statSync(FILE).size;
    } catch {
      size = 0;
    }
    if (size > MAX_BYTES) writeFileSync(FILE, "");
    appendFileSync(FILE, `${new Date().toISOString()} ${String(message).slice(0, 300)}\n`);
  } catch {
    // Sin traza, pero con el escaneo intacto.
  }
}

export function readEvents(limit = 60) {
  try {
    const lines = readFileSync(FILE, "utf8").trim().split("\n");
    return lines.filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}
