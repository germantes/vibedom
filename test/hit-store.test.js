import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REF_DIRECT,
  REFERRER_NONE,
  clampDays,
  createHitStore,
  normalizeHit,
  normalizePath,
  normalizeRef,
  normalizeReferrerHost,
} from "../src/backend/hit-store.js";

const silent = { log() {}, warn() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 10, 26, 12, 0, 0);

const visit = (overrides = {}) => ({
  path: "/",
  lang: "es",
  ref: "hn",
  referrer: "news.ycombinator.com",
  ...overrides,
});

function memoryStore(options = {}) {
  return createHitStore({ restUrl: "", restToken: "", logger: silent, now: () => TODAY, ...options });
}

test("normalizePath solo acepta rutas cortas del sitio", () => {
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/en/"), "/en/");
  assert.equal(normalizePath("/sound-tests/"), "/sound-tests/");
  assert.equal(normalizePath("/en/what-does-my-website-sound-like/"), "/en/what-does-my-website-sound-like/");
  assert.equal(normalizePath("/../etc/passwd"), null);
  assert.equal(normalizePath("/a/../../b"), null);
  assert.equal(normalizePath("/en/?ref=hn"), null);
  assert.equal(normalizePath("en/"), null);
  assert.equal(normalizePath(`/${"a".repeat(121)}`), null);
  assert.equal(normalizePath(""), null);
});

test("normalizeRef y el referrer tiran la búsqueda, el www y las IP", () => {
  assert.equal(normalizeRef(""), REF_DIRECT);
  assert.equal(normalizeRef(null), REF_DIRECT);
  assert.equal(normalizeRef("HN"), "hn");
  assert.equal(normalizeRef("dev-to"), "dev-to");
  assert.equal(normalizeRef("con espacios"), null);
  assert.equal(normalizeRef("x".repeat(33)), null);

  assert.equal(normalizeReferrerHost(""), REFERRER_NONE);
  assert.equal(normalizeReferrerHost("https://www.Reddit.com/r/webdev?x=1"), "reddit.com");
  assert.equal(normalizeReferrerHost("news.ycombinator.com"), "news.ycombinator.com");
  assert.equal(normalizeReferrerHost("8.8.8.8"), REFERRER_NONE);
  assert.equal(normalizeReferrerHost("2001:db8::1"), REFERRER_NONE);
  assert.equal(normalizeReferrerHost("no es un host"), null);
});

test("normalizeHit no copia IP ni campos de más", () => {
  assert.deepEqual(normalizeHit({ ...visit(), ip: "203.0.113.8", ua: "spy" }), {
    path: "/",
    lang: "es",
    ref: "hn",
    referrer: "news.ycombinator.com",
  });
  assert.equal(normalizeHit({ path: "/", lang: "fr", ref: "hn", referrer: "" }), null);
  assert.equal(normalizeHit(["/", "es"]), null);
  assert.equal(normalizeHit(null), null);
});

test("clampDays acepta 1..32 y rechaza el resto", () => {
  assert.equal(clampDays(null), 7);
  assert.equal(clampDays(""), 7);
  assert.equal(clampDays("30"), 30);
  assert.equal(clampDays("0"), null);
  assert.equal(clampDays("33"), null);
  assert.equal(clampDays("7.5"), null);
});

test("el store en memoria agrega por día, ruta, canal y referrer", async () => {
  let now = TODAY;
  const store = memoryStore({ now: () => now });

  assert.equal(await store.record(visit()), true);
  assert.equal(await store.record(visit({ lang: "en" })), true);
  assert.equal(await store.record(visit({ ref: "" })), true);
  assert.equal(await store.record(visit({ path: "/en/", lang: "en", ref: "reddit", referrer: "" })), true);
  now -= 3 * DAY;
  assert.equal(await store.record(visit({ ref: "ph", referrer: "www.producthunt.com" })), true);
  now -= 40 * DAY;
  assert.equal(await store.record(visit({ ref: "old" })), true);
  now = TODAY;

  const stats = await store.stats({ days: 7 });
  assert.equal(stats.days, 7);
  assert.equal(stats.to, "2026-11-26");
  assert.equal(stats.from, "2026-11-20");
  assert.equal(stats.total, 5);

  assert.deepEqual(stats.byRef, [
    { ref: "hn", count: 2 },
    { ref: "direct", count: 1 },
    { ref: "ph", count: 1 },
    { ref: "reddit", count: 1 },
  ]);
  assert.deepEqual(stats.byPath, [
    { path: "/", count: 4 },
    { path: "/en/", count: 1 },
  ]);
  assert.deepEqual(stats.byReferrer, [
    { host: "news.ycombinator.com", count: 3 },
    { host: "none", count: 1 },
    { host: "producthunt.com", count: 1 },
  ]);

  const today = stats.rows.filter((row) => row.date === "2026-11-26");
  assert.equal(today.length, 3);
  assert.equal(today.find((row) => row.ref === "hn").count, 2);
  assert.ok(stats.rows.every((row) => row.ref !== "old"));
  assert.equal(JSON.stringify(stats).includes("203.0.113"), false);
});

test("una visita de hace más de 40 días se olvida al registrar otra", async () => {
  let now = TODAY;
  const store = memoryStore({ now: () => now });
  await store.record(visit({ ref: "vieja" }));
  now += 41 * DAY;
  await store.record(visit({ ref: "nueva" }));
  now = TODAY;
  assert.equal((await store.stats({ days: 1 })).total, 0);
});

test("el tope diario no crea combinaciones nuevas, pero sigue sumando las ya vistas", async () => {
  const store = memoryStore({ maxFields: 2 });
  assert.equal(await store.record(visit({ ref: "hn" })), true);
  assert.equal(await store.record(visit({ ref: "reddit" })), true);
  assert.equal(await store.record(visit({ ref: "ph" })), false);
  assert.equal(await store.record(visit({ ref: "hn" })), true);

  const stats = await store.stats({ days: 1 });
  assert.equal(stats.total, 3);
  assert.deepEqual(
    stats.byRef.map((item) => item.ref),
    ["hn", "reddit"],
  );
});

test("sin Upstash, el snapshot dice que el contador está en memoria", () => {
  assert.deepEqual(memoryStore().snapshot(), { backend: "memory", durable: false });
});

test("con Upstash usa HINCRBY para sumar y HGETALL para leer", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const commands = JSON.parse(options.body);
    requests.push({ url, commands, authorization: options.headers.Authorization });
    const results = commands.map(([name]) => {
      if (name === "HGETALL") return { result: ["/\thn\tnews.ycombinator.com", "5"] };
      return { result: 1 };
    });
    return { ok: true, json: async () => results };
  };

  const store = createHitStore({
    restUrl: "https://fake.upstash.io/",
    restToken: "token-secreto",
    fetchImpl,
    logger: silent,
    now: () => TODAY,
  });

  assert.equal(await store.record(visit({ referrer: "https://www.news.ycombinator.com/item?id=1" })), true);
  const stats = await store.stats({ days: 1 });

  assert.equal(stats.total, 5);
  assert.deepEqual(stats.rows, [
    { date: "2026-11-26", path: "/", ref: "hn", referrer: "news.ycombinator.com", count: 5 },
  ]);
  assert.deepEqual(requests[0].commands, [
    ["HINCRBY", "vibedom:hits:v1:2026-11-26", "/\thn\tnews.ycombinator.com", "1"],
    ["EXPIRE", "vibedom:hits:v1:2026-11-26", String(40 * 24 * 60 * 60)],
  ]);
  assert.equal(requests[1].commands[0][0], "HGETALL");
  assert.equal(requests[1].commands[0][1], "vibedom:hits:v1:2026-11-26");
  assert.equal(requests[0].authorization, "Bearer token-secreto");
  assert.equal(requests[0].url, "https://fake.upstash.io/pipeline");
  assert.deepEqual(store.snapshot(), { backend: "upstash", durable: true });
});

test("si Upstash falla al leer, se usan los totales de este proceso", async () => {
  const fetchImpl = async () => {
    throw new Error("red caída");
  };
  const store = createHitStore({
    restUrl: "https://fake.upstash.io",
    restToken: "token",
    fetchImpl,
    logger: silent,
    now: () => TODAY,
  });

  assert.equal(await store.record(visit()), false);
  const stats = await store.stats({ days: 1 });
  assert.equal(stats.total, 1);
  assert.equal(stats.byRef[0].ref, "hn");
});

test("si Redis responde vacío tras un fallo de escritura, cuenta lo de este proceso", async () => {
  const fetchImpl = async (_url, options) => {
    const commands = JSON.parse(options.body);
    return { ok: true, json: async () => commands.map(() => ({ result: {} })) };
  };
  const store = createHitStore({
    restUrl: "https://fake.upstash.io",
    restToken: "token",
    fetchImpl,
    logger: silent,
    now: () => TODAY,
  });
  assert.equal(await store.record(visit({ ref: "devto" })), true);
  const stats = await store.stats({ days: 1 });
  assert.equal(stats.total, 1);
  assert.equal(stats.byRef[0].ref, "devto");
});

test("HGETALL en forma de objeto también se agrega", async () => {
  const fetchImpl = async (_url, options) => {
    const commands = JSON.parse(options.body);
    return {
      ok: true,
      json: async () =>
        commands.map(([name]) =>
          name === "HGETALL" ? { result: { "/en/\tlinkedin\tlinkedin.com": "2" } } : { result: 1 },
        ),
    };
  };
  const store = createHitStore({
    restUrl: "https://fake.upstash.io",
    restToken: "token",
    fetchImpl,
    logger: silent,
    now: () => TODAY,
  });
  const stats = await store.stats({ days: 1 });
  assert.deepEqual(stats.byPath, [{ path: "/en/", count: 2 }]);
  assert.deepEqual(stats.byReferrer, [{ host: "linkedin.com", count: 2 }]);
});
