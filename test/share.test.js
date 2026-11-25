import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeShortToken, decodeAnyToken } from "../src/embed.js";
import { createShareStore, SHORT_ID_SOURCE } from "../src/backend/share-store.js";
import { startServer } from "../src/backend/server.js";
import { createRateLimiter } from "../src/backend/rate-limit.js";

const SEED = JSON.parse(await readFile(new URL("../presets/cyberpunk.json", import.meta.url), "utf8"));
const memoryStore = () => createShareStore({ restUrl: "", restToken: "", logger: null });

test("el almacén en memoria crea IDs cortos y los resuelve", async () => {
  const store = memoryStore();
  const token = encodeShortToken(SEED);

  const id = await store.create(token);
  assert.ok(SHORT_ID_SOURCE.test(String(id)), `ID mal formado: ${id}`);
  assert.equal(await store.resolve(id), token);
  assert.equal(await store.resolve("noexis"), null);
  assert.deepEqual(store.snapshot(), { backend: "memory", durable: false, ttlS: 2592000 });
});

test("el almacén Upstash envía SET NX EX y reintenta colisiones", async () => {
  const commands = [];
  // Cada llamada al fetch consume el siguiente resultado de la cola.
  const queue = [{ result: "OK" }];
  const fakeFetch = async (url, init) => {
    commands.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => (queue.length ? queue.shift() : { result: null }),
    };
  };

  const store = createShareStore({
    restUrl: "https://cache.example",
    restToken: "tok",
    fetchImpl: fakeFetch,
    logger: null,
  });

  const token = encodeShortToken(SEED);
  const id = await store.create(token);
  assert.ok(SHORT_ID_SOURCE.test(String(id)));

  const [set] = commands;
  assert.equal(set[0], "SET");
  assert.equal(set[2], token);
  assert.equal(set[3], "NX");
  assert.equal(set[4], "EX");
  assert.equal(set[5], "2592000");
  assert.match(set[1], /^vibedom:share:v1:[A-Za-z0-9]{7}$/);

  // Colisión: el primero rechaza y el segundo acepta.
  queue.length = 0;
  queue.push({ result: null }, { result: "OK" });
  commands.length = 0;
  const second = await store.create(token);
  assert.ok(second, "debe reintentar tras una colisión NX");
  assert.notEqual(second, id);

  // Lectura: GET devuelve el token guardado o null.
  queue.length = 0;
  queue.push({ result: "valor-guardado" });
  assert.equal(await store.resolve("abc2345"), "valor-guardado");
  queue.length = 0;
  assert.equal(await store.resolve("abc2345"), null);

  // Fallo de red: nunca lanza, devuelve null para caer al enlace largo.
  const broken = createShareStore({
    restUrl: "https://cache.example",
    restToken: "tok",
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    logger: null,
  });
  assert.equal(await broken.create(token), null);
  assert.equal(await broken.resolve("abc2345"), null);
});

test("POST /api/share devuelve un enlace corto y /s/<id> sirve la vista previa", async () => {
  const server = await startServer({ port: 0, shareStore: memoryStore() });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = encodeShortToken(SEED);

    const res = await fetch(`${base}/api/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.url, /\/s\/[A-Za-z0-9]{7}$/);
    assert.ok(SHORT_ID_SOURCE.test(body.id));

    const preview = await fetch(body.url);
    assert.equal(preview.status, 200);
    const html = await preview.text();
    assert.match(html, /Cyberpunk/);
    assert.match(html, /#seed=/);

    // La imagen OG de la vista previa también funciona con el ID.
    const image = await fetch(`${body.url}.png`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");

    // La semilla restaurada es la misma que se compartió.
    const restored = decodeAnyToken(token);
    assert.equal(restored.metadata.detectedVibe, SEED.metadata.detectedVibe);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/share rechaza tokens inválidos y limita ráfagas", async () => {
  const server = await startServer({
    port: 0,
    shareRateLimit: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    shareStore: memoryStore(),
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = encodeShortToken(SEED);
    const post = (payload) =>
      fetch(`${base}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    const bad = await post({ token: "esto-no-es-una-semilla" });
    assert.equal(bad.status, 400);
    const empty = await post({});
    assert.equal(empty.status, 400);

    const first = await post({ token });
    assert.equal(first.status, 200);
    const second = await post({ token });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("un ID inexistente muestra la página de error sin romper nada", async () => {
  const server = await startServer({ port: 0, shareStore: memoryStore() });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/s/aaaabbb`);
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /enlace no lleva una semilla válida|link doesn't carry a valid seed/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
