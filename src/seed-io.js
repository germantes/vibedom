// Exportar e importar la Semilla Sonora como archivo JSON. La validación es
// siempre la del contrato (normalizeSeed): nada llega al motor sin pasarla.

import { normalizeSeed } from "./engine/seed.js";

/** Serializa la semilla para descargarla tal cual se ve en el playground. */
export function serializeSeed(seed) {
  return JSON.stringify(seed, null, 2);
}

/** Nombre de archivo sugerido: `vibedom-<host o vibe>.json`. */
export function seedFileName(seed) {
  let slug = "";
  const url = seed?.metadata?.url;
  if (typeof url === "string") {
    try {
      slug = new URL(url).host.replace(/^www\./, "");
    } catch {
      slug = "";
    }
  }
  if (!slug) {
    slug = String(seed?.metadata?.detectedVibe ?? "vibedom").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vibedom";
  }
  return `vibedom-${slug}.json`;
}

/**
 * Lee el texto de un archivo importado y devuelve la semilla saneada.
 * Lanza si el texto no es JSON o no cumple el contrato; la UI decide
 * cómo traducir el fallo.
 */
export function parseSeedText(text) {
  const raw = JSON.parse(String(text));
  return normalizeSeed(raw);
}
