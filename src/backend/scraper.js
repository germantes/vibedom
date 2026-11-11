// Scraper ligero: extrae señales estéticas y semánticas de una URL sin navegador.
// Usa solo fetch (zero deps). El HTML se recorre con indexOf: los regex de
// etiquetas (`<meta[^>]*…`, `<h1[^>]*>…`) eran cuadráticos y, al ser síncronos,
// bloqueaban el proceso entero. No ve CSS computado ni contenido JS-rendered,
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
// Presupuesto total del escaneo. Render corta las peticiones que pasan de ~60 s
// con un 502 sin cuerpo; con este tope siempre llegamos a responder (semilla
// local) y a decir por qué.
const SCRAPE_BUDGET_MS = 20000;
const MAX_CSS_FETCHES = 4;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;
// Lo que se manda al modelo. Un <title> o un <h1> de cientos de KB no aportan
// señal y sí inflan el prompt (y la factura).
const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_HEADING_CHARS = 120;
const MAX_TEXT_SAMPLE = 600;
// Buscar </h1> o </title> hasta el final del documento, una vez por etiqueta,
// vuelve a ser cuadrático si la etiqueta no cierra. Este tope acota cada búsqueda.
const MAX_ELEMENT_RAW = 4_000;
const TEXTUAL = /^(text\/|application\/(?:xhtml\+xml|xml|json|javascript|css)|$)/i;
/** Host de una URL, para trazas sin rutas ni parámetros privados. */
function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return "?";
  }
}

const RETRYABLE =
  /^(?:HTTP (?:403|429|5\d\d)|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_[A-Z_]+|fetch failed)(?: \d+ms)?$/;

/** Fallo al descargar la portada, con el rastro de lo que respondió el servidor. */
export class ScrapeError extends Error {
  constructor(message, { trace = [] } = {}) {
    super(message);
    this.name = "ScrapeError";
    this.code = "SCRAPE_FAILED";
    this.diagnostic = trace.join(" → ");
  }
}

/**
 * Lee el cuerpo en trozos y corta la conexión en cuanto supera `maxBytes`.
 * `content-length` puede faltar (chunked) o mentir; `res.text()` se lo tragaría
 * entero, y con 4 CSS en paralelo eso tumba una instancia de 512 MB.
 */
async function readLimited(res, maxBytes) {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") return { overflow: false, text: "" };

  const reader = body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const size = value?.byteLength ?? 0;
      if (!size) continue;
      if (received + size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { overflow: true, text: "" };
      }
      received += size;
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }

  return { overflow: false, text: chunks.length ? Buffer.concat(chunks).toString("utf8") : "" };
}

/** Fetch con timeout, redirecciones controladas y User-Agent. */
async function safeFetch(
  url,
  { fetchImpl = fetch, validateUrl = null, signal, headers = {}, trace, onTrace, deadline, maxBytes = MAX_BYTES } = {},
) {
  let current = url;
  // `trace` se queda en el error (diagnóstico para el cliente); `onTrace`
  // persiste en /tmp para saber hasta dónde llegó un proceso que se cayó.
  const note = (line) => {
    trace?.push(line);
    onTrace?.(line);
  };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline ? deadline - Date.now() : FETCH_TIMEOUT;
    if (remaining <= 0) {
      note("tiempo agotado");
      return null;
    }

    if (validateUrl) await validateUrl(current);
    if (signal?.aborted) throw signal.reason ?? new Error("Escaneo cancelado");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.min(FETCH_TIMEOUT, remaining));
    const startedHop = Date.now();

    try {
      const res = await fetchImpl(current, {
        signal: controller.signal,
        headers: { "User-Agent": UA, Accept: "text/html,text/css,application/xhtml+xml,*/*;q=0.5", ...headers },
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          note(`${res.status} sin Location`);
          return null;
        }
        const next = new URL(location, current);
        // El cuerpo de una redirección no se usa: se descarta para no dejar
        // sockets abiertos esperando a que alguien lo lea.
        await res.body?.cancel().catch(() => {});
        note(`${res.status}→${next.host} ${Date.now() - startedHop}ms`);
        current = next.href;
        continue;
      }

      if (!res.ok) {
        note(`HTTP ${res.status} ${Date.now() - startedHop}ms`);
        await res.body?.cancel().catch(() => {});
        return null;
      }

      const type = (res.headers.get("content-type") ?? "").trim();
      if (type && !TEXTUAL.test(type)) {
        note(`contenido ${type.split(/[;\s]/)[0]}`);
        await res.body?.cancel().catch(() => {});
        return null;
      }

      const length = Number(res.headers.get("content-length"));
      if (Number.isFinite(length) && length > maxBytes) {
        note(`demasiado grande (${Math.round(length / 1024)} KB)`);
        await res.body?.cancel().catch(() => {});
        return null;
      }

      const read = await readLimited(res, maxBytes);
      if (read.overflow) {
        note(`demasiado grande (>${Math.round(maxBytes / 1024)} KB)`);
        return null;
      }
      const text = read.text;
      note(`leída ${hostOf(current)} ${Math.round(text.length / 1024)}KB ${Date.now() - startedHop}ms`);
      return { text, url: current };
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      const reason =
        err?.name === "AbortError"
          ? deadline && Date.now() >= deadline
            ? "tiempo agotado"
            : "timeout"
          : err?.cause?.code || err?.code || err?.message || "error de red";
      note(`${String(reason).slice(0, 60)} ${Date.now() - startedHop}ms`);
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  note("demasiadas redirecciones");
  return null;
}

// ---- Extractores de HTML ---------------------------------------------------
// Un solo pase con indexOf. Cada búsqueda empieza donde acabó la anterior, así
// que un HTML de `<meta ` repetido (sin `>`) termina en una pasada y no en el
// reintento cuadrático del regex `[^>]*…[^>]*`.

function isNameChar(code) {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45 || code === 58;
}

function isSpace(code) {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function clipText(value, max) {
  if (typeof value !== "string" || value.length <= max) return value;
  let end = max;
  const tail = value.charCodeAt(end - 1);
  // No partir un par subrogado (un emoji a caballo del corte).
  if (tail >= 0xd800 && tail <= 0xdbff) end -= 1;
  return value.slice(0, Math.max(0, end));
}

/** Atributo dentro de una etiqueta ya delimitada por `>`. Solo mira ese trozo. */
function attrValue(attrs, attrsLower, name) {
  let i = 0;
  while (i < attrs.length) {
    while (i < attrs.length && (isSpace(attrsLower.charCodeAt(i)) || attrsLower[i] === "/")) i++;
    if (i >= attrs.length) break;
    let j = i;
    while (j < attrs.length && isNameChar(attrsLower.charCodeAt(j))) j++;
    if (j === i) {
      i++;
      continue;
    }
    const key = attrsLower.slice(i, j);
    i = j;
    while (i < attrs.length && isSpace(attrsLower.charCodeAt(i))) i++;
    if (attrsLower[i] !== "=") continue;
    i++;
    while (i < attrs.length && isSpace(attrsLower.charCodeAt(i))) i++;
    if (i >= attrs.length) break;
    const quote = attrs[i];
    let value = "";
    if (quote === '"' || quote === "'") {
      const end = attrs.indexOf(quote, i + 1);
      value = end === -1 ? attrs.slice(i + 1) : attrs.slice(i + 1, end);
      i = end === -1 ? attrs.length : end + 1;
    } else {
      const start = i;
      while (i < attrs.length && !isSpace(attrsLower.charCodeAt(i))) i++;
      value = attrs.slice(start, i);
    }
    if (key === name) return value;
  }
  return null;
}

/** Salta un <script> o <style> cerrado. null si no hay cierre: no nos tragamos el resto. */
function skipBlock(lower, gt, name) {
  const marker = `</${name}`;
  const at = lower.indexOf(marker, gt + 1);
  if (at === -1) return null;
  const closeGt = lower.indexOf(">", at + marker.length);
  if (closeGt === -1) return null;
  return { contentEnd: at, next: closeGt + 1 };
}

/** Texto hasta el cierre, acotado para que un <h1> sin </h1> no rescanee la página. */
function readInner(html, lower, gt, name) {
  const marker = `</${name}`;
  const windowEnd = Math.min(html.length, gt + 1 + MAX_ELEMENT_RAW);
  const at = lower.slice(gt + 1, windowEnd).indexOf(marker);
  if (at === -1) return html.slice(gt + 1, windowEnd);
  return html.slice(gt + 1, gt + 1 + at);
}

/**
 * Recorre etiquetas de apertura. `onTag` puede devolver el índice por el que
 * seguir, o false para parar. <script> y <style> cerrados no se visitan: su
 * contenido no es texto visible. El CSS de <style> sale por `onStyle`.
 */
function walkHtml(html, { onText, onTag, onStyle } = {}) {
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = lower.indexOf("<", i);
    if (lt === -1) {
      if (i < html.length) onText?.(html.slice(i));
      break;
    }
    if (lt > i) onText?.(html.slice(i, lt));

    if (lower.startsWith("<!--", lt)) {
      const end = lower.indexOf("-->", lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }

    const gt = lower.indexOf(">", lt + 1);
    if (gt === -1) {
      onText?.(html.slice(lt));
      break;
    }

    const code = lower.charCodeAt(lt + 1);
    if (code < 97 || code > 122) {
      i = gt + 1;
      continue;
    }

    let nameEnd = lt + 2;
    while (nameEnd < gt && isNameChar(lower.charCodeAt(nameEnd))) nameEnd++;
    const name = lower.slice(lt + 1, nameEnd);

    if (name === "script" || name === "style") {
      const skipped = skipBlock(lower, gt, name);
      if (skipped) {
        if (name === "style") onStyle?.(html.slice(gt + 1, skipped.contentEnd));
        i = skipped.next;
        continue;
      }
    }

    // El retorno es una señal: un índice para seguir, o false para parar.
    // Cualquier otro valor (también el número que devuelve Array.push) se ignora.
    const next = onTag?.({
      name,
      attrs: html.slice(nameEnd, gt),
      attrsLower: lower.slice(nameEnd, gt),
      gt,
      lower,
      html,
    });
    if (next === false) return;
    i = typeof next === "number" && next > gt ? next : gt + 1;
  }
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
  const parts = [];
  walkHtml(html, {
    onText: (chunk) => parts.push(chunk),
    onTag: () => {
      parts.push(" ");
    },
  });
  return decodeEntities(parts.join("").replace(/\s+/g, " ").trim());
}

export function extractSemantic(html) {
  let title = "";
  let description = "";
  let ogDescription = "";
  const headings = [];
  let sample = "";

  walkHtml(html, {
    onText: (chunk) => {
      if (sample.length >= MAX_TEXT_SAMPLE + 200) return;
      sample += chunk.slice(0, MAX_TEXT_SAMPLE + 200 - sample.length);
    },
    onTag: (tag) => {
      if (tag.name === "title" && !title) {
        title = clipText(decodeEntities(readInner(tag.html, tag.lower, tag.gt, "title")).trim(), MAX_TITLE_CHARS);
        return;
      }
      if (tag.name === "meta") {
        const content = attrValue(tag.attrs, tag.attrsLower, "content");
        if (!content) return;
        const name = (attrValue(tag.attrs, tag.attrsLower, "name") || "").toLowerCase();
        const prop = (attrValue(tag.attrs, tag.attrsLower, "property") || "").toLowerCase();
        const text = clipText(decodeEntities(content).trim(), MAX_DESCRIPTION_CHARS);
        if (!text) return;
        if (!description && name === "description") description = text;
        else if (!ogDescription && prop === "og:description") ogDescription = text;
        return;
      }
      if (tag.name === "h1" && headings.length < 5) {
        const text = stripTags(readInner(tag.html, tag.lower, tag.gt, "h1"));
        if (text) headings.push(clipText(text, MAX_HEADING_CHARS));
      }
    },
  });

  return {
    title,
    description: description || ogDescription,
    headings,
    textSample: decodeEntities(sample.replace(/\s+/g, " ").trim()).slice(0, MAX_TEXT_SAMPLE),
  };
}

export function extractThemeColor(html) {
  let value = null;
  walkHtml(html, {
    onTag: (tag) => {
      if (tag.name !== "meta") return;
      if ((attrValue(tag.attrs, tag.attrsLower, "name") || "").toLowerCase() !== "theme-color") return;
      value = (attrValue(tag.attrs, tag.attrsLower, "content") || "").trim();
      return false;
    },
  });
  return /^#[0-9a-fA-F]{3,8}$/.test(value ?? "") ? value : null;
}

// ---- Extractores de CSS ----------------------------------------------------

async function gatherCSS(html, baseUrl, fetchOptions) {
  const styles = [];
  const hrefs = [];
  const inlineAttrs = [];

  walkHtml(html, {
    onStyle: (css) => styles.push(css),
    onTag: (tag) => {
      if (tag.name === "link") {
        const rel = (attrValue(tag.attrs, tag.attrsLower, "rel") || "").toLowerCase();
        if (rel.split(/\s+/).includes("stylesheet")) {
          const href = attrValue(tag.attrs, tag.attrsLower, "href")?.trim();
          if (href) hrefs.push(href);
        }
      }
      const style = attrValue(tag.attrs, tag.attrsLower, "style");
      if (style) inlineAttrs.push(style);
    },
  });

  const unique = [...new Set(hrefs)].slice(0, MAX_CSS_FETCHES);
  const sheets = await Promise.all(unique.map(async (href) => (await safeFetch(new URL(href, baseUrl).href, fetchOptions))?.text));

  return [styles.join("\n"), ...sheets.filter(Boolean), inlineAttrs.join("; ")].join("\n");
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

// Recorrido lineal de reglas CSS. El regex anterior (`([^{}]+)\{([^{}]*)\}`)
// era cuadrático cuando el CSS tenía un tramo largo sin llaves —los atributos
// style= de Blogger son un caso real—: 349 KB tardaban más de 60 s y dejaban el
// proceso sin responder hasta que Render lo reiniciaba.
function findBackgroundColor(css) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const close = css.indexOf("}", open + 1);
    if (close === -1) break;

    // Con reglas anidadas (@media) interesa solo el selector más interno.
    const raw = css.slice(i, open);
    const cut = Math.max(raw.lastIndexOf("{"), raw.lastIndexOf("}"));
    const selectors = cut === -1 ? raw : raw.slice(cut + 1);

    if (/(?:^|,)\s*(?:html|body|:root)\b/i.test(selectors)) {
      const match = css.slice(open + 1, close).match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;}]+)/i);
      const color = match && colorFromValue(match[1]);
      if (color) return color;
    }
    i = close + 1;
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
  const { onTrace } = options;
  const note = (line) => onTrace?.(line);
  const deadline = Date.now() + SCRAPE_BUDGET_MS;
  const trace = [];
  note(`scrape ${hostOf(url)}`);
  let page = await safeFetch(url, { ...options, trace, deadline });

  // Segundo intento como navegador solo ante bloqueos del servidor: es el caso
  // típico de un WAF que rechaza al bot, no el de un timeout o un PDF.
  if (!page && RETRYABLE.test(trace.at(-1) ?? "")) {
    trace.push("reintento como navegador");
    note("reintento como navegador");
    page = await safeFetch(url, { ...options, trace, deadline, headers: BROWSER_HEADERS });
  }

  if (!page) {
    throw new ScrapeError(
      `No se pudo cargar ${url}${trace.length ? ` (${trace.join(" → ")})` : ""}`,
      { trace },
    );
  }

  const html = page.text;
  note(`html ${Math.round(html.length / 1024)}KB`);
  const semantic = extractSemantic(html);
  const themeColor = extractThemeColor(html);
  // Las rutas relativas se resuelven contra la URL final tras redirecciones.
  const css = await gatherCSS(html, page.url, { ...options, deadline });
  note(`css ${Math.round(css.length / 1024)}KB`);
  const colors = extractColors(css, themeColor);
  const fonts = extractFonts(css);
  const motion = detectMotion(css);
  note(`señales ${colors.all?.length ?? 0} colores ${fonts.families?.length ?? 0} fuentes`);

  return { url, finalUrl: page.url, ...semantic, themeColor, colors, fonts, ...motion };
}
