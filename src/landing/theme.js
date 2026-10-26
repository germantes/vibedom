// Utilidades de color para el tema dinámico de la landing.
//
// La semilla trae la paleta del sitio escaneado, pero no podemos confiar en que
// su texto y su acento sean legibles sobre su propio fondo (un sitio puede tener
// un amarillo pálido sobre blanco). Aquí calculamos versiones con contraste
// suficiente y derivamos el resto de variables CSS.

/** "#abc", "#abcd", "#aabbcc" o "#aabbccdd" → "#aabbcc"; null si no es un hex. */
export function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3,8}$/i.test(raw)) return null;
  if (raw.length === 3 || raw.length === 4) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (raw.length === 6 || raw.length === 8) return `#${raw.slice(0, 6).toLowerCase()}`;
  return null;
}

export function toRgb(hex) {
  const value = normalizeHex(hex);
  if (!value) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

export function toHex({ r, g, b }) {
  const part = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Luminancia relativa sRGB (0 = negro, 1 = blanco). */
export function relativeLuminance(hex) {
  const rgb = toRgb(hex);
  if (!rgb) return 0;
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Contraste WCAG entre dos colores (1 = idénticos, 21 = negro/blanco). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mezcla lineal en sRGB: t = 0 devuelve a, t = 1 devuelve b. */
export function mixHex(a, b, t) {
  const ca = toRgb(a);
  const cb = toRgb(b);
  if (!ca || !cb) return normalizeHex(a) ?? normalizeHex(b) ?? "#000000";
  const k = Math.min(1, Math.max(0, t));
  return toHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

/** Texto legible sobre un fondo: respeta el preferido si supera 4.5:1. */
export function textFor(background, preferred) {
  const bg = normalizeHex(background);
  if (!bg) return null;
  const candidate = normalizeHex(preferred);
  if (candidate && contrastRatio(candidate, bg) >= 4.5) return candidate;

  const dark = "#0a0a0c";
  const light = "#f4f1e8";
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
}

/** Color de texto sobre un relleno de acento (el que más contraste da). */
export function onColorFor(background) {
  const bg = normalizeHex(background);
  if (!bg) return "#0a0a0c";
  return contrastRatio("#0a0a0c", bg) >= contrastRatio("#ffffff", bg) ? "#0a0a0c" : "#ffffff";
}

/**
 * Acento visible sobre el fondo: si no llega al mínimo (3:1 para formas y
 * bordes, 4.5:1 para texto) lo acerca a blanco o negro sin cambiar de familia.
 */
export function accentFor(accent, background, min = 3) {
  const bg = normalizeHex(background);
  const base = normalizeHex(accent);
  if (!base) return null;
  if (!bg || contrastRatio(base, bg) >= min) return base;

  const target = relativeLuminance(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(base, target, step / 20);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return target;
}

/** rgba() a partir de un hex, para glows y sombras. */
export function withAlpha(hex, alpha) {
  const rgb = toRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
