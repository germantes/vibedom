// Genera el snippet del widget con la Semilla Sonora incrustada.
//
// La semilla va en base64 dentro de `data-seed`: el snippet no depende de la
// caché del servidor ni de una URL concreta, y cada visitante escucha su web
// sin generar ni una llamada a la IA.

export const DEFAULT_WIDGET_BASE = "https://vibedom.dev";

/** JSON → UTF-8 → base64, seguro dentro de un atributo HTML. */
export function encodeSeed(seed) {
  const bytes = new TextEncoder().encode(JSON.stringify(seed));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
