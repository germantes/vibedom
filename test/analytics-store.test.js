import { test } from "node:test";
import assert from "node:assert/strict";

import { createAnalyticsStore, visitorHash } from "../src/backend/analytics-store.js";

const silent = { log() {}, warn() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 10, 26, 12, 0, 0);
const IP = "203.0.113.50";

function memoryStore(options = {}) {
  return createAnalyticsStore({
    restUrl: "",
    restToken: "",
    secret: "sal-de-prueba",
    logger: silent,
    now: () => TODAY,
    ...options,
  });
}

const pageview = {
  event: "pageview",
  path: "/",
  lang: "es",
  ref: "hn",
  referrer: "https://news.ycombinator.com/item?id=9",
};

test("el hash diario no contiene la IP y cambia al día siguiente", () => {
  const today = visitorHash(IP, "2026-11-26", "sal-de-prueba");
  const again = visitorHash(IP, "2026-11-26", "sal-de-prueba");
  const tomorrow = visitorHash(IP, "2026-11-27", "sal-de-prueba");

  assert.equal(today, again);
  assert.notEqual(today, tomorrow);
  assert.match(today, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(today.includes(IP), false);
  assert.equal(visitorHash("unknown", "2026-11-26", "sal-de-prueba"), null);
  assert.equal(visitorHash("", "2026-11-26", "sal-de-prueba"), null);
});

test("la misma IP el mismo día cuenta una sola vez, y la visita sí se suma", async () => {
  const store = memoryStore();

  assert.equal(await store.record(pageview, { ip: IP }), true);
  assert.equal(await store.record({ ...pageview, lang: "en" }, { ip: IP }), true);
  assert.equal(await store.record({ ...pageview, ref: "no-existe" }, { ip: "198.51.100.7" }), true);
  assert.equal(await store.record({ event: "scan", path: "/playground/", lang: "es", ref: "reddit" }, {}), true);
  assert.equal(await store.record({ event: "widget", path: "/lo-que-sea", lang: "en", referrer: "blog.example" }), true);
  assert.equal(await store.record({ event: "pageview", path: "/admin", lang: "es" }), false);

  const week = await store.summary(7);
  assert.equal(week.totals.pageview, 3);
  assert.equal(week.totals.scan, 1);
  assert.equal(week.totals.widget, 1);
  assert.equal(week.uniques, 2);
  assert.equal(week.byRef.find((row) => row.ref === "hn").pageview, 2);
  assert.equal(week.byRef.find((row) => row.ref === "direct").pageview, 1);
  assert.equal(week.byReferrer.find((row) => row.host === "news.ycombinator.com").pageview, 3);
  assert.equal(week.byPath.find((row) => row.path === "/embed").widget, 1);
  assert.equal(JSON.stringify(week).includes(IP), false);
});

test("los periodos suman los días UTC y el hash no cruza de un día a otro", async () => {
  let now = TODAY;
  const store = memoryStore({ now: () => now });
  const hit = { event: "pageview", path: "/en/", lang: "en", ref: "x", referrer: "t.co" };

  await store.record(hit, { ip: IP });
  now = TODAY - 3 * DAY;
  await store.record(hit, { ip: IP });
  now = TODAY - 20 * DAY;
  await store.record({ ...hit, ref: "ph" }, { ip: IP });
  now = TODAY - 40 * DAY;
  await store.record(hit, { ip: IP });
  now = TODAY;

  const week = await store.summary(7);
  const month = await store.summary(30);
  assert.equal(week.totals.pageview, 2);
  assert.equal(week.uniques, 2);
  assert.equal(month.totals.pageview, 3);
  assert.equal(month.uniques, 3);
  assert.equal(month.byRef.find((row) => row.ref === "ph").pageview, 1);
  assert.equal(week.from < week.to, true);
});

test("un referrer de más se pliega en other y no guarda la IP", async () => {
  const warnings = [];
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(options.body);
    throw new Error("red caída");
  };
  const store = createAnalyticsStore({
    restUrl: "https://fake.upstash.io",
    restToken: "token",
    secret: "sal-de-prueba",
    fetchImpl,
    logger: { log() {}, error() {}, warn: (message) => warnings.push(String(message)) },
    now: () => TODAY,
    maxReferrers: 1,
  });

  await store.record(pageview, { ip: IP });
  assert.equal(
    await store.record({ ...pageview, referrer: "https://www.reddit.com/r/webdev" }, { ip: "198.51.100.20" }),
    false,
  );

  const week = await store.summary(7);
  assert.equal(week.byReferrer.find((row) => row.host === "news.ycombinator.com").pageview, 1);
  assert.equal(week.byReferrer.find((row) => row.host === "other").pageview, 1);
  assert.equal(week.uniques, 2);

  const blob = `${requests.join("\n")}\n${warnings.join("\n")}`;
  assert.equal(blob.includes(IP), false);
  assert.equal(blob.includes("198.51.100.20"), false);
  assert.match(requests[0], /HINCRBY/);
  assert.match(requests[0], /PFADD/);
  assert.doesNotMatch(requests[0], /user-agent/i);
});

test("con Upstash lee HGETALL y PFCOUNT, y sin credenciales lo dice", async () => {
  assert.deepEqual(memoryStore().snapshot(), { backend: "memory", durable: false });

  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      { result: ["pageview|/|hn|news.ycombinator.com", "4", "widget|/embed|direct|blog.example", "1"] },
      { result: ["scan|/playground/|reddit|-", "2"] },
      { result: 3 },
      { result: 1 },
    ],
  });
  const store = createAnalyticsStore({
    restUrl: "https://fake.upstash.io/",
    restToken: "token",
    secret: "sal-de-prueba",
    fetchImpl,
    logger: silent,
    now: () => TODAY,
  });

  assert.deepEqual(store.snapshot(), { backend: "upstash", durable: true });
  const week = await store.summary(2);
  assert.equal(week.totals.pageview, 4);
  assert.equal(week.totals.scan, 2);
  assert.equal(week.totals.widget, 1);
  assert.equal(week.uniques, 4);
  assert.equal(week.byRef.find((row) => row.ref === "reddit").scan, 2);
  assert.equal(week.byReferrer.find((row) => row.host === "direct").scan, 2);
});
