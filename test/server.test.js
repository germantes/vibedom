import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync } from "node:fs";

import { startServer } from "../src/backend/server.js";
import { UnsafeUrlError } from "../src/backend/url-guard.js";

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
      calls.translate.push({ signals, signal: options?.signal });
      return SEED;
    },
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

test("POST /api/scan devuelve 502 si el escaneo falla", async () => {
  const res = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://rota.test/" }),
  });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /no responde/);
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

test("no sirve dotfiles ni permite directory traversal", async () => {
  const env = await fetch(`${base}/.env`);
  assert.equal(env.status, 404);
  assert.doesNotMatch(await env.text(), /GEMINI_KEY/);

  const traversal = await rawRequest("/%2e%2e%2fpackage.json");
  assert.equal(traversal.status, 403);
  assert.doesNotMatch(traversal.body, /"name": "vibedom"/);
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
