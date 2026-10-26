// Servidor: archivos estáticos + POST /api/scan.
// Zero deps: node:http + node:fs + node:path.
//
// Exporta createVibedomServer() para poder montarlo en tests con dependencias
// falsas (scraper, traductor y validador de URLs inyectables).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scrapeUrl } from "./scraper.js";
import { resolveLang, translate } from "./translator.js";
import { assertPublicUrl, UnsafeUrlError } from "./url-guard.js";
import { createRateLimiter } from "./rate-limit.js";
import { cacheKey, createScanCache } from "./scan-cache.js";
import { createGeminiLimiter } from "./gemini-limiter.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, "../..");
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_FALLBACK_S = 30;

const SCAN_ERROR_COPY = {
  es: {
    rateLimited: (seconds) =>
      `El analizador está saturado ahora mismo. Espera ${seconds} s y vuelve a intentarlo.`,
    unavailable: "No se pudo analizar la web. Prueba un preset o inténtalo de nuevo en unos segundos.",
  },
  en: {
    rateLimited: (seconds) => `The analyser is busy right now. Wait ${seconds}s and try again.`,
    unavailable: "Couldn't analyse the site. Try a preset or try again in a few seconds.",
  },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// ---- Helpers ---------------------------------------------------------------

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(payload);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "Cuerpo de la petición demasiado grande");
    chunks.push(chunk);
  }

  if (!size) throw httpError(400, "Cuerpo vacío");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "JSON inválido en el cuerpo de la petición");
  }
}

// ---- POST /api/scan --------------------------------------------------------

function makeScanHandler({ scrape, translateSeed, validateUrl, logger, cache, limiter }) {
  return async function handleScan(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return json(res, err.status ?? 400, { error: err.message });
    }

    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) return json(res, 400, { error: 'Falta el campo "url"' });
    const lang = resolveLang(body?.lang);

    let target;
    try {
      target = await validateUrl(url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) return json(res, 400, { error: err.message });
      return json(res, 400, { error: "URL inválida" });
    }

    // Repetir un escaneo reciente no vuelve a llamar a Gemini. La copia cambia
    // con el idioma de la página, así que cada idioma tiene su propia entrada.
    const key = `${lang}:${cacheKey(target)}`;
    const cached = cache.get(key);
    if (cached) {
      logger.log(`[scan] ♻ ${target} (caché)`);
      return json(res, 200, cached, { "X-Vibedom-Cache": "HIT" });
    }

    // Si el navegador cancela el análisis, se aborta la descarga y la llamada a Gemini.
    const controller = new AbortController();
    let clientGone = false;
    const onClose = () => {
      if (!res.writableEnded) {
        clientGone = true;
        controller.abort();
      }
    };
    res.on("close", onClose);

    try {
      logger.log(`[scan] Scrapeando ${target}…`);
      const signals = await scrape(target, { validateUrl, signal: controller.signal });
      logger.log(
        `[scan] Señales: ${signals.colors?.all?.length ?? 0} colores, ${signals.fonts?.families?.length ?? 0} fuentes, dark=${signals.colors?.isDark ?? false}`,
      );
      logger.log("[scan] Llamando a Gemini…");
      const seed = await translateSeed(signals, { signal: controller.signal, lang, logger, limiter });
      logger.log(
        `[scan] ✔ ${seed.metadata.detectedVibe} — ${seed.musicalParams.rootNote} ${seed.musicalParams.scale} ${seed.musicalParams.bpm} BPM`,
      );
      cache.set(key, seed);
      return json(res, 200, seed, { "X-Vibedom-Cache": "MISS" });
    } catch (err) {
      if (clientGone || controller.signal.aborted) return;

      if (err instanceof UnsafeUrlError) {
        logger.error(`[scan] ✖ ${err.message}`);
        return json(res, 400, { error: err.message });
      }

      const copy = SCAN_ERROR_COPY[lang] ?? SCAN_ERROR_COPY.es;

      if (err?.code === "RATE_LIMITED") {
        const retryAfter = Math.max(1, Math.ceil(Number(err.retryAfter) || RATE_LIMIT_FALLBACK_S));
        logger.warn(`[scan] ⏳ ${err.message} · reintentar en ${retryAfter} s`);
        return json(
          res,
          429,
          { code: "RATE_LIMITED", error: copy.rateLimited(retryAfter), retryAfter },
          { "Retry-After": String(retryAfter) },
        );
      }

      logger.error(`[scan] ✖ ${err.message}`);
      return json(res, 502, { code: "ANALYSIS_FAILED", error: copy.unavailable });
    } finally {
      res.off("close", onClose);
    }
  };
}

// ---- Archivos estáticos ----------------------------------------------------

function makeStaticHandler(root) {
  return async function handleStatic(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
      return;
    }

    if (pathname.endsWith("/")) pathname += "index.html";

    // Nunca servir dotfiles (.env, .git, .DS_Store…); "." y ".." los valida el traversal.
    if (pathname.split("/").some((part) => part.startsWith(".") && part !== "." && part !== "..")) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    // Prevenir directory traversal
    const filePath = resolve(root, `.${pathname}`);
    const rel = relative(root, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("not a file");
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
  };
}

// ---- Router ----------------------------------------------------------------

/**
 * Crea el servidor HTTP. Las dependencias son inyectables para los tests.
 */
export function createVibedomServer({
  root = DEFAULT_ROOT,
  scrape = scrapeUrl,
  translateSeed,
  geminiLimiter = createGeminiLimiter(),
  validateUrl = assertPublicUrl,
  rateLimit = createRateLimiter(),
  cache = createScanCache(),
  logger = console,
} = {}) {
  // El limitador global se aplica a todas las llamadas a Gemini del proceso.
  const translateWithLimit =
    translateSeed ??
    ((signals, options = {}) => translate(signals, { ...options, limiter: options.limiter ?? geminiLimiter }));
  const handleScan = makeScanHandler({
    scrape,
    translateSeed: translateWithLimit,
    validateUrl,
    cache,
    logger,
    limiter: geminiLimiter,
  });
  const handleStatic = makeStaticHandler(root);

  return createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      return res.end();
    }

    if (req.method === "GET" && req.url === "/api/health") {
      return json(res, 200, {
        ok: true,
        service: "vibedom",
        commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      });
    }

    if (req.method === "POST" && req.url === "/api/scan") {
      const quota = rateLimit(req);
      if (!quota.ok) {
        return json(
          res,
          429,
          {
            code: "RATE_LIMITED",
            error: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.",
            retryAfter: quota.retryAfter,
          },
          { "Retry-After": String(quota.retryAfter) },
        );
      }
      return handleScan(req, res);
    }

    if (req.method === "GET" || req.method === "HEAD") return handleStatic(req, res);

    res.writeHead(405, { Allow: "GET, POST, OPTIONS" }).end();
  });
}

/** Arranca el servidor en el puerto indicado (0 = efímero, útil en tests). */
export function startServer({ port = DEFAULT_PORT, ...options } = {}) {
  const server = createVibedomServer(options);
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolvePromise(server);
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = await startServer().catch((err) => {
    console.error(`No se pudo arrancar el servidor: ${err.message}`);
    process.exit(1);
  });
  const { port } = server.address();
  console.log(`vibedom http://localhost:${port}`);
}
