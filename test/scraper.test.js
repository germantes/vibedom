import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeEntities,
  detectMotion,
  extractColors,
  extractFonts,
  extractSemantic,
  extractThemeColor,
  hexToRgb,
  rgbToHex,
  ScrapeError,
  scrapeUrl,
} from "../src/backend/scraper.js";

/** Respuesta HTML/CSS falsa para no depender de la red. */
function textResponse(body, type = "text/html; charset=utf-8", status = 200) {
  return new Response(body, { status, headers: { "content-type": type } });
}

function redirectResponse(location) {
  return new Response(null, { status: 302, headers: { location } });
}

const HTML = `<!doctype html>
<html>
  <head>
    <title>  Estudio &amp; Diseño  </title>
    <meta name="description" content="Portfolio de tipografía y código" />
    <meta name="theme-color" content="#ff0055" />
    <style>
      html, body { background: #0b0b0f; color: rgba(240, 240, 255, 0.9); }
      a { color: #00ffcc; }
      .card { border-color: #00ffcc80; }
      h1 { font-family: "Space Mono", ui-monospace, monospace; }
      p { font-family: Georgia, serif; }
      .motion { animation: float 2s infinite; }
      .fade { transition: opacity 0.3s ease; }
      @keyframes float { from { opacity: 0 } to { opacity: 1 } }
    </style>
    <link rel="stylesheet" href="/css/app.css" />
  </head>
  <body>
    <h1>Hola <em>mundo</em></h1>
    <h1>Segundo título</h1>
    <p>Texto visible &hellip; con <strong>negrita</strong>.</p>
  </body>
</html>`;

const APP_CSS = `
  :root { --accent: #ff0055; }
  body { background-color: #0b0b0f; }
  .btn { color: #00ffcc; background: rgb(10, 10, 15); }
`;

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    if (typeof route === "function") return route(url, options);
    return route;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("decodeEntities resuelve entidades con nombre, decimales y hexadecimales", () => {
  assert.equal(decodeEntities("A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#x27; &hellip;"), "A & B <c> \"d\" 'e' …");
  assert.equal(decodeEntities("&desconocida;"), "&desconocida;");
  assert.equal(decodeEntities("&#x1f3b5;"), "🎵");
});

test("extractSemantic limpia etiquetas, decodifica y recorta", () => {
  const semantic = extractSemantic(HTML);
  assert.equal(semantic.title, "Estudio & Diseño");
  assert.equal(semantic.description, "Portfolio de tipografía y código");
  assert.deepEqual(semantic.headings, ["Hola mundo", "Segundo título"]);
  assert.match(semantic.textSample, /Texto visible … con negrita/);
  assert.doesNotMatch(semantic.textSample, /Space Mono/);
});

test("extractThemeColor solo acepta hex", () => {
  assert.equal(extractThemeColor(HTML), "#ff0055");
  assert.equal(extractThemeColor('<meta name="theme-color" content="rebeccapurple">'), null);
});

test("hexToRgb/rgbToHex soportan alfa y recortan valores", () => {
  assert.deepEqual(hexToRgb("#00ffcc80"), [0, 255, 204]);
  assert.deepEqual(hexToRgb("#abc"), [170, 187, 204]);
  assert.equal(rgbToHex([0, 255, 300]), "#00ffff");
  assert.equal(rgbToHex([-10, 12, 300]), "#000cff");
});

test("extractColors detecta fondo, modo oscuro y paleta", () => {
  const colors = extractColors(`${HTML.match(/<style>([\s\S]*?)<\/style>/)[1]}\n${APP_CSS}`, "#ff0055");
  assert.equal(colors.background, "#0b0b0f");
  assert.equal(colors.isDark, true);
  assert.ok(colors.all.includes("#00ffcc"));
  assert.ok(colors.all.includes("#ff0055"));
  assert.ok(colors.all.length <= 8);
});

test("extractColors usa theme-color si no hay CSS y aclara fondos claros", () => {
  const colors = extractColors("", "#ff0055");
  assert.deepEqual(colors.all, ["#ff0055"]);
  assert.equal(colors.background, "#ffffff");
  assert.equal(colors.isDark, false);

  const light = extractColors("body { background: #fafafa; color: #111; }");
  assert.equal(light.background, "#fafafa");
  assert.equal(light.isDark, false);
});

test("extractFonts clasifica familias y deduplica categorías", () => {
  const fonts = extractFonts(`
    h1 { font-family: "Space Mono", ui-monospace, monospace; }
    p { font-family: Georgia, "Times New Roman", serif; }
    .a { font-family: system-ui, sans-serif; }
    .b { font-family: "Comic Neue", cursive; }
  `);
  assert.ok(fonts.families.includes("space mono"));
  assert.deepEqual(new Set(fonts.categories), new Set(["monospace", "serif", "sans-serif", "display"]));
});

test("detectMotion detecta animaciones y transiciones", () => {
  assert.deepEqual(detectMotion(HTML), { hasAnimations: true, hasTransitions: true });
  assert.deepEqual(detectMotion("body { color: red }"), { hasAnimations: false, hasTransitions: false });
});

test("scrapeUrl combina HTML, CSS enlazada y atributos style", async () => {
  const fetchImpl = mockFetch({
    "https://studio.test/": textResponse(HTML),
    "https://studio.test/css/app.css": textResponse(APP_CSS, "text/css"),
  });

  const signals = await scrapeUrl("https://studio.test/", { fetchImpl });

  assert.equal(signals.url, "https://studio.test/");
  assert.equal(signals.title, "Estudio & Diseño");
  assert.equal(signals.themeColor, "#ff0055");
  assert.equal(signals.colors.background, "#0b0b0f");
  assert.equal(signals.colors.isDark, true);
  assert.ok(signals.fonts.categories.includes("monospace"));
  assert.equal(signals.hasAnimations, true);
  assert.equal(signals.hasTransitions, true);
  assert.equal(fetchImpl.calls.length, 2);
});

test("scrapeUrl sigue redirecciones validando cada salto", async () => {
  const fetchImpl = mockFetch({
    "http://old.test/": () => redirectResponse("https://new.test/home"),
    "https://new.test/home": textResponse(HTML),
    "https://new.test/css/app.css": textResponse(APP_CSS, "text/css"),
  });
  const visited = [];

  const signals = await scrapeUrl("http://old.test/", {
    fetchImpl,
    validateUrl: async (url) => visited.push(url),
  });

  assert.equal(signals.title, "Estudio & Diseño");
  assert.deepEqual(visited.slice(0, 2), ["http://old.test/", "https://new.test/home"]);
  assert.ok(visited.includes("https://new.test/css/app.css"));
});

test("scrapeUrl propaga el aborto y los rechazos del validador", async () => {
  const fetchImpl = mockFetch({ "https://studio.test/": textResponse(HTML) });

  await assert.rejects(
    scrapeUrl("https://studio.test/", {
      fetchImpl,
      validateUrl: async () => {
        throw new Error("destino bloqueado");
      },
    }),
    /destino bloqueado/,
  );

  await assert.rejects(
    scrapeUrl("https://studio.test/", { fetchImpl, signal: AbortSignal.abort(new Error("cancelado")) }),
    /cancelado/,
  );
});

test("scrapeUrl rechaza respuestas no textuales y fallos de red", async () => {
  await assert.rejects(
    scrapeUrl("https://img.test/", {
      fetchImpl: async () => textResponse("binario", "image/png"),
    }),
    /No se pudo cargar/,
  );

  await assert.rejects(
    scrapeUrl("https://down.test/", {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
    /No se pudo cargar/,
  );
});

test("reintenta como navegador si el WAF responde 403 y explica el fallo definitivo", async () => {
  const attempts = [];
  const fetchImpl = async (url, options) => {
    attempts.push(options.headers["User-Agent"]);
    return attempts.length === 1 ? textResponse("bloqueado", "text/html", 403) : textResponse(HTML);
  };

  const signals = await scrapeUrl("https://blog.test/", { fetchImpl });
  assert.equal(signals.title, "Estudio & Diseño");
  assert.match(attempts[0], /VibeDomBot/);
  assert.match(attempts[1], /Chrome\//);

  await assert.rejects(
    scrapeUrl("https://muro.test/", {
      fetchImpl: async () => textResponse("nope", "text/html", 403),
    }),
    (err) => {
      assert.ok(err instanceof ScrapeError);
      assert.match(err.message, /HTTP 403/);
      assert.match(err.diagnostic, /^HTTP 403 \d+ms → reintento como navegador → HTTP 403 \d+ms$/);
      return true;
    },
  );
});
