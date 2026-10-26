import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cacheKey, createScanCache } from "../src/backend/scan-cache.js";
import { startServer } from "../src/backend/server.js";

const SEED = JSON.parse(readFileSync(new URL("../presets/editorial.json", import.meta.url), "utf8"));
const silent = { log() {}, warn() {}, error() {} };

test("cacheKey normaliza hash, barra final y mayúsculas del host", () => {
  assert.equal(cacheKey("https://Example.com/foo/#hola"), "https://example.com/foo");
  assert.equal(cacheKey("https://example.com/foo"), "https://example.com/foo");
  assert.equal(cacheKey("https://example.com/"), "https://example.com/");
  assert.equal(cacheKey("https://example.com/?a=1#x"), "https://example.com/?a=1");
});

test("la caché guarda, caduca y respeta el TTL", () => {
  let now = 1_000;
  const cache = createScanCache({ ttlMs: 60_000, now: () => now });

  assert.equal(cache.get("a"), undefined);
  cache.set("a", { seed: 1 });
  assert.deepEqual(cache.get("a"), { seed: 1 });

  now += 59_999;
  assert.deepEqual(cache.get("a"), { seed: 1 });

  now += 1;
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 0);
});

test("al llenarse desaloja la entrada usada hace más tiempo", () => {
  const cache = createScanCache({ ttlMs: 60_000, max: 2, now: () => 0 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a"); // "a" pasa a ser la más reciente
  cache.set("c", 3);

  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});

test("ttl 0 desactiva la caché", () => {
  const cache = createScanCache({ ttlMs: 0 });
  cache.set("a", 1);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.enabled, false);
});

test("un escaneo repetido sale de caché y no vuelve a llamar a Gemini", async () => {
  let scrapes = 0;
  let translations = 0;
  const server = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => url,
    scrape: async (url) => {
      scrapes += 1;
      return { url, colors: { all: ["#111111"], isDark: true }, fonts: { families: [] } };
    },
    translateSeed: async () => {
      translations += 1;
      return SEED;
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const scan = (url) =>
    fetch(`${base}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

  try {
    const first = await scan("https://cache.test/");
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-vibedom-cache"), "MISS");
    assert.deepEqual(await first.json(), SEED);

    const second = await scan("https://cache.test/#seccion");
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("x-vibedom-cache"), "HIT");
    assert.deepEqual(await second.json(), SEED);

    assert.equal(scrapes, 1);
    assert.equal(translations, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("la caché distingue el idioma de la copia", async () => {
  let translations = 0;
  const server = await startServer({
    port: 0,
    logger: silent,
    validateUrl: async (url) => url,
    scrape: async (url) => ({ url, colors: { all: ["#111111"], isDark: true }, fonts: { families: [] } }),
    translateSeed: async (_signals, { lang }) => {
      translations += 1;
      return { ...SEED, metadata: { ...SEED.metadata, detectedVibe: lang } };
    },
    rateLimit: () => ({ ok: true, remaining: 99, retryAfter: 0 }),
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const scan = (lang) =>
    fetch(`${base}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://lang.cache.test/", lang }),
    });

  try {
    const es = await scan("es");
    assert.equal(es.headers.get("x-vibedom-cache"), "MISS");
    assert.equal((await es.json()).metadata.detectedVibe, "es");

    const en = await scan("en");
    assert.equal(en.headers.get("x-vibedom-cache"), "MISS");
    assert.equal((await en.json()).metadata.detectedVibe, "en");

    const again = await scan("es");
    assert.equal(again.headers.get("x-vibedom-cache"), "HIT");
    assert.equal((await again.json()).metadata.detectedVibe, "es");
    assert.equal(translations, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
