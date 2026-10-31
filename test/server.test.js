import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync } from "node:fs";

import { startServer } from "../src/backend/server.js";
import { createScanCache } from "../src/backend/scan-cache.js";
import { createScanBudget } from "../src/backend/scan-budget.js";
import { UnsafeUrlError } from "../src/backend/url-guard.js";
import { encodeShareToken } from "../src/embed.js";

const SEED = JSON.parse(readFileSync(new URL("../presets/editorial.json", import.meta.url), "utf8"));
const silent = { log() {}, warn() {}, error() {} };

let server;
let base;

const calls = { validate: [], scrape: [], translate: [] };

before(async () => {
  server = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => {
      calls.validate.push(url);
      if (url.includes("bloqueada")) throw new UnsafeUrlError("destino bloqueado");
      return url;
    },
    scrape: async (url, options) => {
      calls.scrape.push({ url, signal: options?.signal });
      if (url.includes("rota")) throw new Error("la web no responde");
      return { url, title: "Studio", colors: { all: ["#111111"], background: "#111111", isDark: true } };
    },
    translateSeed: async (signals, options) => {
      calls.translate.push({ signals, signal: options?.signal, lang: options?.lang, limiter: options?.limiter });
      return SEED;
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    scanBudget: createScanBudget({ dailyLimit: 0, ipLimit: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function resetCalls() {
  calls.validate.length = 0;
  calls.scrape.length = 0;
  calls.translate.length = 0;
}

/** Petición HTTP cruda (sin normalizar el path como hace fetch). */
function rawRequest(path, { method = "GET", body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("POST /api/scan ejecuta scraper + traductor y devuelve la semilla", async () => {
  resetCalls();
  const res = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://studio.test/" }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, SEED);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls.validate, ["https://studio.test/"]);
  assert.equal(calls.scrape.length, 1);
  assert.equal(calls.translate.length, 1);
  assert.ok(calls.scrape[0].signal instanceof AbortSignal);
  assert.ok(calls.translate[0].signal instanceof AbortSignal);
  assert.equal(calls.translate[0].lang, "es");
  assert.equal(typeof calls.translate[0].limiter.run, "function");
});

test("POST /api/scan pasa el idioma pedido al traductor", async () => {
  resetCalls();
  const res = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://studio.test/en/", lang: "en" }),
  });
  assert.equal(res.status, 200);
  assert.equal(calls.translate[0].lang, "en");

  resetCalls();
  const invalid = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://studio.test/fr/", lang: "fr" }),
  });
  assert.equal(invalid.status, 200);
  assert.equal(calls.translate[0].lang, "es");
});

test("POST /api/scan valida el cuerpo y la URL", async () => {
  const empty = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /url/);

  const badJson = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{nope",
  });
  assert.equal(badJson.status, 400);

  const blocked = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://bloqueada.test/" }),
  });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /bloqueado/);
});

test("si la web no se puede leer, la demo responde con una semilla local", async () => {
  const res = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://rota.test/" }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-vibedom-source"), "local");

  const body = await res.json();
  assert.equal(body.metadata.source, "local");
  assert.equal(body.metadata.unreadable, true);
  assert.equal(body.metadata.url, "https://rota.test/");
  assert.match(body.metadata.explanation, /no pudimos ver/i);
  assert.doesNotMatch(body.metadata.explanation, /fondo oscuro/i);
  assert.ok(body.musicalParams.bpm > 0);
});

test("sin fallback local, un escaneo roto sigue devolviendo un 502 genérico", async () => {
  const bare = await startServer({
    port: 0,
    logger: silent,
    localFallback: false,
    validateUrl: async (url) => url,
    scrape: async (url) => {
      throw Object.assign(new Error("HTTP 403 desde blogspot"), { code: "SCRAPE_FAILED" });
    },
    translateSeed: async () => SEED,
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const bareBase = `http://127.0.0.1:${bare.address().port}`;

  try {
    const res = await fetch(`${bareBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://rota.test/" }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.code, "ANALYSIS_FAILED");
    assert.match(body.error, /No se pudo analizar/);
    assert.doesNotMatch(body.error, /blogspot/);
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

test("POST /api/scan rechaza cuerpos demasiado grandes", async () => {
  const res = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://studio.test/", relleno: "x".repeat(20_000) }),
  });
  assert.equal(res.status, 413);
});

test("sirve index.html en / y tipos MIME correctos", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /vibedom/);

  const js = await fetch(`${base}/src/engine/scales.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
});

test("sirve landing y playground bilingües en sus rutas estáticas", async () => {
  const landingEs = await fetch(`${base}/`);
  const htmlEs = await landingEs.text();
  assert.match(htmlEs, /lang="es"/);
  assert.match(htmlEs, /banda sonora/i);

  const landingEn = await fetch(`${base}/en/`);
  assert.equal(landingEn.status, 200);
  const htmlEn = await landingEn.text();
  assert.match(htmlEn, /lang="en"/);
  assert.match(htmlEn, /soundtrack/i);

  const playEs = await fetch(`${base}/playground/`);
  assert.equal(playEs.status, 200);
  assert.match(await playEs.text(), /Escucha, ajusta, rompe/);

  const playEn = await fetch(`${base}/playground/en/`);
  assert.equal(playEn.status, 200);
  assert.match(await playEn.text(), /Listen, tweak, break things/);

  const css = await fetch(`${base}/src/landing/landing.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);

  const sitemap = await fetch(`${base}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /xml/);
  assert.match(await sitemap.text(), /hreflang="en"/);

  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/vibedom\.dev\/sitemap\.xml/);
});

test("sirve las páginas SEO bilingües en sus rutas estáticas", async () => {
  const seoEs = await fetch(`${base}/que-suena-mi-web/`);
  assert.equal(seoEs.status, 200);
  assert.match(seoEs.headers.get("content-type"), /text\/html/);
  const htmlEs = await seoEs.text();
  assert.match(htmlEs, /lang="es"/);
  assert.match(htmlEs, /La respuesta corta/);
  assert.match(htmlEs, /"@type": "FAQPage"/);

  const seoEn = await fetch(`${base}/en/what-does-my-website-sound-like/`);
  assert.equal(seoEn.status, 200);
  const htmlEn = await seoEn.text();
  assert.match(htmlEn, /lang="en"/);
  assert.match(htmlEn, /The short answer/);
  assert.match(htmlEn, /"@type": "FAQPage"/);

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sitemap, /https:\/\/vibedom\.dev\/que-suena-mi-web\//);
  assert.match(sitemap, /https:\/\/vibedom\.dev\/en\/what-does-my-website-sound-like\//);
});

test("no sirve dotfiles ni permite directory traversal", async () => {
  const env = await fetch(`${base}/.env`);
  assert.equal(env.status, 404);
  assert.doesNotMatch(await env.text(), /GEMINI_KEY/);

  const traversal = await rawRequest("/%2e%2e%2fpackage.json");
  assert.equal(traversal.status, 403);
  assert.doesNotMatch(traversal.body, /"name": "vibedom"/);
});

test("GET /api/health responde sin caché y con CORS", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const body = await res.json();
  assert.deepEqual({ ...body, engine: undefined, budget: undefined, usage: undefined }, {
    ok: true,
    service: "vibedom",
    commit: null,
    engine: undefined,
    budget: undefined,
    usage: undefined,
  });
  assert.ok(["local", "gemini", "vertex"].includes(body.engine));
  assert.equal(body.budget.dailyLimit, 0);
  assert.equal(body.budget.perIpDailyLimit, 0);
  assert.equal(typeof body.budget.usedToday, "number");
  assert.equal(body.usage.calls, 0);
  assert.equal(body.usage.estimatedUsd, 0);
});

test("un 429 de Gemini se cubre con una semilla local en vez de bloquear la demo", async () => {
  const limited = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, title: "Studio" }),
    translateSeed: async () => {
      throw Object.assign(new Error("Gemini 429: quota exceeded"), {
        code: "RATE_LIMITED",
        retryAfter: 9,
      });
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const limitedBase = `http://127.0.0.1:${limited.address().port}`;

  try {
    const res = await fetch(`${limitedBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://studio.test/", lang: "en" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-vibedom-source"), "local");
    assert.equal(res.headers.get("retry-after"), null);
    const body = await res.json();
    assert.equal(body.metadata.source, "local");
    assert.match(body.metadata.explanation, /BPM/);
    assert.ok(body.synthConfig.pad.filterFreq > 0);
    assert.doesNotMatch(JSON.stringify(body), /Gemini|quota/);
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});

test("un 429 con espera larga también devuelve semilla local", async () => {
  const limited = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, title: "Studio", colors: { all: ["#101820", "#ff4d8d"], background: "#101820", isDark: true } }),
    translateSeed: async () => {
      throw Object.assign(new Error("Gemini 429: quota exceeded"), {
        code: "RATE_LIMITED",
        retryAfter: 52_391,
      });
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const limitedBase = `http://127.0.0.1:${limited.address().port}`;

  try {
    const res = await fetch(`${limitedBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://studio.test/", lang: "es" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.metadata.source, "local");
    assert.equal(body.uiTheme.backgroundColor, "#101820");
    assert.match(body.metadata.explanation, /fondo oscuro/i);
    assert.match(body.metadata.explanation, /BPM/);
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});

test("el 429 amable sigue disponible si se desactiva el fallback local", async () => {
  const limited = await startServer({
    port: 0,
    logger: silent,
    localFallback: false,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, title: "Studio" }),
    translateSeed: async () => {
      throw Object.assign(new Error("Gemini 429: quota exceeded"), {
        code: "RATE_LIMITED",
        retryAfter: 52_391,
      });
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const limitedBase = `http://127.0.0.1:${limited.address().port}`;

  try {
    const res = await fetch(`${limitedBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://studio.test/", lang: "es" }),
    });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "52391");
    const body = await res.json();
    assert.equal(body.retryAfter, 52_391);
    assert.match(body.error, /límite de uso/);
    assert.match(body.error, /15 h/);
    assert.doesNotMatch(body.error, /52391/);
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});

test("durante el enfriamiento de Gemini no se espera la cola: semilla local directa", async () => {
  let translated = 0;
  const server = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, title: "Studio" }),
    translateSeed: async () => {
      translated += 1;
      return SEED;
    },
    geminiLimiter: { cooldownSeconds: 3600, run: (task) => task() },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const localBase = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${localBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://studio.test/", lang: "es" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-vibedom-source"), "local");
    assert.equal(translated, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("el tope diario corta la IA y responde con la semilla local", async () => {
  let translated = 0;
  const server = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => url,
    scrape: async (url) => ({
      url,
      title: "Studio",
      colors: { all: ["#101820"], background: "#101820", isDark: true },
    }),
    translateSeed: async () => {
      translated += 1;
      return SEED;
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    scanBudget: createScanBudget({ dailyLimit: 1, ipLimit: 50 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const localBase = `http://127.0.0.1:${server.address().port}`;

  const scan = (url) =>
    fetch(`${localBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, lang: "es" }),
    });

  try {
    const first = await scan("https://studio.test/");
    assert.equal(first.status, 200);
    assert.equal(translated, 1);

    const second = await scan("https://otra-web.test/");
    assert.equal(second.status, 200);
    assert.equal(translated, 1, "la segunda no debe llamar a la IA");
    assert.equal(second.headers.get("x-vibedom-source"), "local");
    const body = await second.json();
    assert.equal(body.metadata.source, "local");
    assert.ok(body.synthConfig.pad.filterFreq > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("si el fallback local está desactivado, el tope diario devuelve 429 amable", async () => {
  const server = await startServer({
    port: 0,
    logger: silent,
    localFallback: false,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, title: "Studio" }),
    translateSeed: async () => SEED,
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    scanBudget: createScanBudget({ dailyLimit: 1, ipLimit: 50 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const localBase = `http://127.0.0.1:${server.address().port}`;

  const scan = (url) =>
    fetch(`${localBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, lang: "es" }),
    });

  try {
    assert.equal((await scan("https://studio.test/")).status, 200);

    const res = await scan("https://otra-web.test/");
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    const body = await res.json();
    assert.equal(body.code, "RATE_LIMITED");
    assert.match(body.error, /límite de uso|saturado/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("el rate limit devuelve 429 con Retry-After antes de procesar el escaneo", async () => {
  const limited = await startServer({
    port: 0,
    logger: silent,
    rateLimit: () => ({ ok: false, remaining: 0, retryAfter: 7 }),
  });
  const limitedBase = `http://127.0.0.1:${limited.address().port}`;
  try {
    const res = await fetch(`${limitedBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "7");
    const body = await res.json();
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.retryAfter, 7);
    assert.match(body.error, /Demasiadas peticiones/);
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});

test("la vista previa compartida expone Open Graph de la semilla y redirige al playground", async () => {
  const token = encodeShareToken(SEED);
  const origin = new URL(base).origin;

  const page = await fetch(`${base}/s/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.equal(page.headers.get("x-robots-tag"), "noindex, follow");

  const html = await page.text();
  assert.match(html, new RegExp(`<meta property="og:image" content="${origin}/s/${token}\\.png"`));
  assert.match(html, /property="og:title"/);
  assert.match(html, new RegExp(`#seed=${token}`));
  assert.match(html, /\/playground\/#seed=/);

  const en = await (await fetch(`${base}/s/${token}?l=en`)).text();
  assert.match(en, /<html lang="en">/);
  assert.match(en, /\/playground\/en\/#seed=/);

  const head = await fetch(`${base}/s/${token}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("la imagen OG del enlace compartido es un PNG 1200×630 con los colores de la semilla", async () => {
  const token = encodeShareToken(SEED);
  const res = await fetch(`${base}/s/${token}.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control"), /immutable/);

  const png = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length > 5000, `la imagen pesa ${png.length} bytes`);
});

test("la vista previa envía a la web estática salvo en local", async () => {
  const token = encodeShareToken(SEED);
  const html = await (await fetch(`${base}/s/${token}`)).text();
  assert.match(html, new RegExp(`${new URL(base).origin}/playground/#seed=${token}`));

  process.env.PUBLIC_SITE = "https://vibedom.dev";
  try {
    const prod = await (await fetch(`${base}/s/${token}`)).text();
    assert.match(prod, new RegExp(`https://vibedom\\.dev/playground/#seed=${token}`));
    assert.match(prod, /<link rel="canonical" href="https:\/\/vibedom\.dev\/playground\/" \/>/);
    assert.match(prod, new RegExp(`og:image" content="${new URL(base).origin}/s/${token}\\.png`));
  } finally {
    delete process.env.PUBLIC_SITE;
  }
});

test("un token corrupto en /s/ devuelve 400 sin redirección", async () => {
  const broken = await fetch(`${base}/s/bm8tZXMtanNvbg`);
  assert.equal(broken.status, 400);
  const html = await broken.text();
  assert.match(html, /no lleva una semilla válida/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);
});

test("responde al preflight CORS y a HEAD", async () => {
  const options = await fetch(`${base}/api/scan`, { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");

  const head = await fetch(`${base}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("métodos no soportados devuelven 405", async () => {
  const res = await fetch(`${base}/api/scan`, { method: "PUT", body: "{}" });
  assert.equal(res.status, 405);
});

test("si la IA se cuelga, el presupuesto de la petición responde con la semilla local", async () => {
  const slow = await startServer({
    port: 0,
    logger: silent,
    requestBudgetMs: 1000,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, title: "Studio", colors: { all: ["#101820"], background: "#101820", isDark: true } }),
    translateSeed: (signals, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason ?? new Error("abortado")), { once: true });
      }),
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
    cache: createScanCache({ ttlMs: 0 }),
  });
  const slowBase = `http://127.0.0.1:${slow.address().port}`;

  try {
    const started = Date.now();
    const res = await fetch(`${slowBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://lenta.test/" }),
    });
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started < 5000);
    assert.equal(res.headers.get("x-vibedom-source"), "local");
    assert.match(res.headers.get("x-vibedom-diagnostic"), /tiempo agotado/);

    const body = await res.json();
    assert.equal(body.metadata.source, "local");
    // Aquí sí había señales: la copia describe la web, no es el caso «ilegible».
    assert.equal(body.metadata.unreadable, undefined);
    assert.equal(body.uiTheme.backgroundColor, "#101820");
  } finally {
    await new Promise((resolve) => slow.close(resolve));
  }
});

test("GET /api/diagnostics expone la traza y el estado del proceso", async () => {
  const res = await fetch(`${base}/api/diagnostics`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.events));
  assert.ok(body.uptimeS >= 0);
  assert.ok(body.rssMb > 0);
});
