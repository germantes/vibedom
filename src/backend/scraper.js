// Scraper ligero: extrae señales estéticas y semánticas de una URL sin navegador.
// Usa solo fetch + regex (zero deps). No ve CSS computado ni contenido JS-rendered,
// pero el LLM interpreta las señales crudas de sobra.
//
// Opciones (pensadas para tests y para el servidor):
//   fetchImpl   fetch alternativo
//   validateUrl callback async que valida cada URL antes de descargarla (anti-SSRF)
//   signal      AbortSignal para cancelar el escaneo

const UA = "Mozilla/5.0 (compatible; VibeDomBot/1.0; +https://github.com/germantes/vibedom)";
// Algunos WAF (Blogger incluido) rechazan el UA de bot desde IPs de datacenter.
// Si el primer intento falla con 403/429/5xx, se repite una vez como navegador.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.7",
};
const FETCH_TIMEOUT = 8000;
const MAX_CSS_FETCHES = 4;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;
const TEXTUAL = /^(text\/|application\/(?:xhtml\+xml|xml|json|javascript|css)|$)/i;
const RETRYABLE = /^(?:HTTP (?:403|429|5\d\d)|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_[A-Z_]+|fetch failed)$/;

/** Fallo al descargar la portada, con el rastro de lo que respondió el servidor. */
export class ScrapeError extends Error {
  constructor(message, { trace = [] } = {}) {
    super(message);
    this.name = "ScrapeError";
    this.code = "SCRAPE_FAILED";
    this.diagnostic = trace.join(" → ");
  }
}

/** Fetch con timeout, redirecciones controladas y User-Agent. */
async function safeFetch(url, { fetchImpl = fetch, validateUrl = null, signal, headers = {}, trace } = {}) {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (validateUrl) await validateUrl(current);
    if (signal?.aborted) throw signal.reason ?? new Error("Escaneo cancelado");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetchImpl(current, {
        signal: controller.signal,
        headers: { "User-Agent": UA, Accept: "text/html,text/css,application/xhtml+xml,*/*;q=0.5", ...headers },
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          trace?.push(`${res.status} sin Location`);
          return null;
        }
        trace?.push(String(res.status));
        current = new URL(location, current).href;
        continue;
      }

      if (!res.ok) {
        trace?.push(`HTTP ${res.status}`);
        return null;
      }

      const type = (res.headers.get("content-type") ?? "").trim();
      if (type && !TEXTUAL.test(type)) {
        trace?.push(`contenido ${type.split(/[;\s]/)[0]}`);
        return null;
      }

      const length = Number(res.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_BYTES) {
        trace?.push(`demasiado grande (${Math.round(length / 1024)} KB)`);
        return null;
      }

      const text = await res.text();
      return { text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text, url: current };
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      const reason =
        err?.name === "AbortError"
          ? "timeout"
          : err?.cause?.code || err?.code || err?.message || "error de red";
      trace?.push(String(reason).slice(0, 60));
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  trace?.push("demasiadas redirecciones");
  return null;
}

// ---- Extractores de HTML ---------------------------------------------------

function first(html, regex) {
  return html.match(regex)?.[1]?.trim() ?? "";
}

function all(html, regex) {
  const out = [];
  for (const m of html.matchAll(regex)) out.push(m[1].trim());
  return out;
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/** Decodifica las entidades HTML más comunes (sin dependencias). */
export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function extractSemantic(html) {
  const title = decodeEntities(first(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description =
    decodeEntities(first(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)) ||
    decodeEntities(first(html, /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)) ||
    decodeEntities(first(html, /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i));

  return {
    title,
    description,
    headings: all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(stripTags).filter(Boolean).slice(0, 5),
    textSample: stripTags(html).slice(0, 600),
  };
}

export function extractThemeColor(html) {
  const value = first(html, /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : null;
}

// ---- Extractores de CSS ----------------------------------------------------

async function gatherCSS(html, baseUrl, fetchOptions) {
  // CSS inline dentro de <style>
  const inline = all(html, /<style[^>]*>([\s\S]*?)<\/style>/gi).join("\n");

  // Hojas enlazadas
  const hrefs = all(html, /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi).concat(
    all(html, /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi),
  );
  const unique = [...new Set(hrefs)].slice(0, MAX_CSS_FETCHES);
  const sheets = await Promise.all(unique.map(async (href) => (await safeFetch(new URL(href, baseUrl).href, fetchOptions))?.text));

  // Atributos style= en elementos
  const inlineAttrs = all(html, /style=["']([^"']+)["']/gi).join("; ");

  return [inline, ...sheets.filter(Boolean), inlineAttrs].join("\n");
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;

function clampByte(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : 0;
}

export function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3 || hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((c) => clampByte(c).toString(16).padStart(2, "0")).join("");
}

export function luminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = clampByte(c) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function colorFromValue(value) {
  if (!value) return null;
  const hex = value.match(HEX_RE)?.[0];
  if (hex) return hexToRgb(hex);
  const rgb = value.match(RGB_RE);
  if (rgb) return [clampByte(rgb[1]), clampByte(rgb[2]), clampByte(rgb[3])];
  return null;
}

function findBackgroundColor(css) {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|,)\s*(?:html|body|:root)\b/i.test(selectors)) continue;
    const match = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;}]+)/i);
    const color = match && colorFromValue(match[1]);
    if (color) return color;
  }
  return null;
}

export function extractColors(css, themeColor = null) {
  const cssRgbs = [];
  for (const m of css.matchAll(HEX_RE)) cssRgbs.push(hexToRgb(m[0]));
  for (const m of css.matchAll(RGB_RE)) cssRgbs.push([clampByte(m[1]), clampByte(m[2]), clampByte(m[3])]);

  // meta theme-color: suele ser el acento real cuando el CSS es externo o está ofuscado.
  // No cuenta como candidato a fondo (es un acento, no una superficie).
  const themeRgb = themeColor ? colorFromValue(themeColor) : null;
  const rgbs = themeRgb ? [...cssRgbs, themeRgb] : cssRgbs;

  if (!rgbs.length) return { all: [], background: null, isDark: false };

  // Frecuencia (agrupando colores cercanos)
  const buckets = new Map();
  for (const rgb of rgbs) {
    const key = rgb.map((c) => Math.round(c / 16) * 16).join(",");
    buckets.set(key, buckets.get(key) ?? { rgb, count: 0 });
    buckets.get(key).count++;
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);

  // Fondo: reglas html/body/:root con background; si no hay, el color CSS más frecuente.
  const bgRgb = findBackgroundColor(css) || (cssRgbs.length ? sorted.find((b) => cssRgbs.includes(b.rgb))?.rgb : null) || [255, 255, 255];

  return {
    all: sorted
      .slice(0, 8)
      .map((b) => rgbToHex(b.rgb))
      .filter((color, i, arr) => arr.indexOf(color) === i),
    background: rgbToHex(bgRgb),
    isDark: luminance(bgRgb) < 0.4,
  };
}

export function extractFonts(css) {
  const families = new Set();
  for (const m of css.matchAll(/font-family\s*:\s*([^;]+)/gi)) {
    for (const f of m[1].split(",")) {
      const clean = f.trim().replace(/["']/g, "").toLowerCase();
      if (clean) families.add(clean);
    }
  }
  const categorize = (f) => {
    if (/\bmono/i.test(f)) return "monospace";
    if (/\bserif\b/i.test(f) && !/sans/i.test(f)) return "serif";
    if (/\bdisplay|comic|decorat|handwrit|script|cursive/i.test(f)) return "display";
    return "sans-serif";
  };
  const list = [...families];
  const categories = [...new Set(list.map(categorize))];
  return { families: list.slice(0, 6), categories };
}

export function detectMotion(css) {
  return {
    hasAnimations: /animation(?:-name)?\s*:/i.test(css) || /@keyframes/i.test(css),
    hasTransitions: /transition\s*:/i.test(css),
  };
}

// ---- API pública -----------------------------------------------------------

export async function scrapeUrl(url, options = {}) {
  const { signal } = options;
  const trace = [];
  let page = await safeFetch(url, { ...options, trace });

  // Segundo intento como navegador solo ante bloqueos del servidor: es el caso
  // típico de un WAF que rechaza al bot, no el de un timeout o un PDF.
  if (!page && RETRYABLE.test(trace.at(-1) ?? "")) {
    trace.push("reintento como navegador");
    page = await safeFetch(url, { ...options, trace, headers: BROWSER_HEADERS });
  }

  if (!page) {
    throw new ScrapeError(
      `No se pudo cargar ${url}${trace.length ? ` (${trace.join(" → ")})` : ""}`,
      { trace },
    );
  }

  const html = page.text;
  const semantic = extractSemantic(html);
  const themeColor = extractThemeColor(html);
  // Las rutas relativas se resuelven contra la URL final tras redirecciones.
  const css = await gatherCSS(html, page.url, options);
  const colors = extractColors(css, themeColor);
  const fonts = extractFonts(css);
  const motion = detectMotion(css);

  return { url, finalUrl: page.url, ...semantic, themeColor, colors, fonts, ...motion };
}
