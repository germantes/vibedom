// Compartir la Semilla Sonora: enlace con el JSON incrustado y snippet del widget.
//
// En ambos casos el JSON viaja en el propio enlace/código: no hay backend, no
// hay base de datos y cada visitante escucha la misma variación sin llamar a la IA.

export const DEFAULT_WIDGET_BASE = "https://vibedom.dev";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function bytesToBinary(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

function binaryToBytes(binary) {
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** JSON → UTF-8 → base64, seguro dentro de un atributo HTML. */
export function encodeSeed(seed) {
  return btoa(bytesToBinary(new TextEncoder().encode(JSON.stringify(seed))));
}

/** JSON → UTF-8 → base64url, seguro dentro del fragmento de una URL. */
export function encodeShareToken(seed) {
  return btoa(bytesToBinary(new TextEncoder().encode(JSON.stringify(seed))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** base64url → JSON. Lanza si el token está corrupto o no es JSON. */
export function decodeShareToken(token) {
  const value = String(token ?? "").trim();
  if (!BASE64URL.test(value)) throw new Error("Token de semilla inválido");

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Token de semilla inválido");
  }
  return JSON.parse(new TextDecoder().decode(binaryToBytes(binary)));
}

/** `#seed=...` listo para añadir a la URL del playground. */
export function buildShareHash(seed) {
  return `#seed=${encodeShareToken(seed)}`;
}

/** Lee `#seed=...`; devuelve `null` si el fragmento no contiene una semilla. */
export function readShareHash(hash) {
  const match = /(?:^#|&)seed=([A-Za-z0-9_-]+)/.exec(String(hash ?? ""));
  return match ? decodeShareToken(match[1]) : null;
}

export function buildWidgetSnippet(seed, { base = DEFAULT_WIDGET_BASE } = {}) {
  const origin = String(base).replace(/\/+$/, "");
  return [
    "<!-- vibedom: música generativa de tu web -->",
    `<script src="${origin}/widget.js"`,
    `        data-seed="${encodeSeed(seed)}"`,
    "        defer></script>",
  ].join("\n");
}
