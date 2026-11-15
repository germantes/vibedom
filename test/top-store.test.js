import { test } from "node:test";
import assert from "node:assert/strict";

import { createTopStore, dayKey, normalizeHost } from "../src/backend/top-store.js";

const silent = { log() {}, warn() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 10, 15, 10, 0, 0);

function memoryStore(options = {}) {
  return createTopStore({ restUrl: "", restToken: "", logger: silent, now: () => TODAY, ...options });
}

test("normalizeHost deja solo el dominio: sin www, ruta, query ni puerto", () => {
  assert.equal(normalizeHost("https://www.Studio.Test/path?q=1#x"), "studio.test");
  assert.equal(normalizeHost("http://blog.example.com:8080/a/b"), "blog.example.com");
  assert.equal(normalizeHost("https://example.com./"), "example.com");
  assert.equal(normalizeHost("ftp://example.com/"), null);
  assert.equal(normalizeHost("https://localhost/"), null);
  assert.equal(normalizeHost("no es una url"), null);
});

test("dayKey usa el día UTC", () => {
  assert.equal(dayKey(Date.UTC(2026, 0, 2, 23, 59)), "2026-01-02");
  assert.equal(dayKey(Date.UTC(2026, 0, 3, 0, 1)), "2026-01-03");
});

test("el store en memoria suma por dominio y ordena por escaneos", async () => {
  const store = memoryStore();

  assert.equal(await store.record("https://a.test/", { ip: "1.1.1.1" }), true);
  assert.equal(await store.record("https://a.test/otra-ruta", { ip: "2.2.2.2" }), true);
  assert.equal(await store.record("https://b.test/", { ip: "3.3.3.3" }), true);

  assert.deepEqual(await store.top("today"), [
    { host: "a.test", count: 2 },
    { host: "b.test", count: 1 },
  ]);
});

test("la misma IP no cuenta dos veces el mismo dominio y día", async () => {
  const store = memoryStore();

  assert.equal(await store.record("https://a.test/", { ip: "9.9.9.9" }), true);
  assert.equal(await store.record("https://www.a.test/otra", { ip: "9.9.9.9" }), false);
  assert.equal(await store.record("https://b.test/", { ip: "9.9.9.9" }), true);

  assert.deepEqual(await store.top("today"), [
    { host: "a.test", count: 1 },
    { host: "b.test", count: 1 },
  ]);
});

test("los periodos suman los últimos días UTC y descartan lo viejo", async () => {
  let now = TODAY;
  const store = memoryStore({ now: () => now });

  await store.record("https://hoy.test/", { ip: "1" });
  now -= 3 * DAY;
  await store.record("https://semana.test/", { ip: "2" });
  now -= 20 * DAY;
  await store.record("https://mes.test/", { ip: "3" });
  now -= 20 * DAY;
  await store.record("https://viejo.test/", { ip: "4" });
  now = TODAY;

  assert.deepEqual(await store.top("today"), [{ host: "hoy.test", count: 1 }]);

  const week = (await store.top("week")).map((item) => item.host).sort();
  assert.deepEqual(week, ["hoy.test", "semana.test"]);

  const month = (await store.top("month")).map((item) => item.host).sort();
  assert.deepEqual(month, ["hoy.test", "mes.test", "semana.test"]);
});

test("sin almacén configurado, /api/health lo marca como memoria", () => {
  assert.deepEqual(memoryStore().snapshot(), { backend: "memory", durable: false });
});

test("con Upstash usa ZINCRBY para sumar y ZUNIONSTORE para leer", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const commands = JSON.parse(options.body);
    requests.push({ url, commands });
    const results = commands.map(([name]) => {
      if (name === "ZREVRANGE") return { result: ["a.test", "4", "b.test", "2"] };
      if (name === "ZUNIONSTORE") return { result: 2 };
      return { result: 1 };
    });
    return { ok: true, json: async () => results };
  };

  const store = createTopStore({
    restUrl: "https://fake.upstash.io/",
    restToken: "token",
    fetchImpl,
    logger: silent,
    now: () => TODAY,
  });

  await store.record("https://a.test/x?y=1", { ip: "7" });
  const items = await store.top("week");

  assert.deepEqual(items, [
    { host: "a.test", count: 4 },
    { host: "b.test", count: 2 },
  ]);
  assert.deepEqual(requests[0].commands[0], ["ZINCRBY", "vibedom:top:v1:2026-11-15", "1", "a.test"]);
  assert.equal(requests[0].commands[1][0], "EXPIRE");

  const read = requests[1].commands;
  assert.equal(read[0][0], "ZUNIONSTORE");
  assert.equal(read[0][2], "7");
  assert.equal(read[0].length, 3 + 7);
  assert.equal(read[1][0], "EXPIRE");
  assert.equal(read[2][0], "ZREVRANGE");
  assert.equal(read[3][0], "DEL");
  assert.equal(requests[1].url, "https://fake.upstash.io/pipeline");

  // La segunda lectura sale de caché: no vuelve a llamar a Upstash.
  await store.top("week");
  assert.equal(requests.length, 2);
});

test("si Upstash falla, el store no lanza y cae a memoria", async () => {
  const warnings = [];
  const store = createTopStore({
    restUrl: "https://fake.upstash.io",
    restToken: "token",
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    logger: { log() {}, warn: (message) => warnings.push(message), error() {} },
    now: () => TODAY,
  });

  assert.equal(await store.record("https://a.test/", { ip: "1" }), false);
  assert.deepEqual(await store.top("today"), [{ host: "a.test", count: 1 }]);
  assert.ok(warnings.some((message) => message.includes("no se pudo guardar")));
  assert.ok(warnings.some((message) => message.includes("no se pudo leer")));
});
