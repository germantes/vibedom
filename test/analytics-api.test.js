import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../src/backend/server.js";
import { createAnalyticsStore } from "../src/backend/analytics-store.js";
import { createRateLimiter } from "../src/backend/rate-limit.js";

const silent = { log() {}, warn() {}, error() {} };
const TOKEN = "secreto-de-stats";
const IP = "203.0.113.77";
const AGENT = "UniqueAgentSentinel/9";

function post(base, body, headers = {}) {
  return fetch(`${base}/api/collect`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("POST /api/collect agrega visitas y GET /api/stats exige STATS_TOKEN", async () => {
  const previous = process.env.STATS_TOKEN;
  const store = createAnalyticsStore({ restUrl: "", restToken: "", secret: "sal-de-prueba", logger: silent });
  const server = await startServer({
    port: 0,
    logger: silent,
    analyticsStore: store,
    analyticsRateLimit: createRateLimiter({ limit: 100 }),
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const restore = () => {
    if (previous === undefined) delete process.env.STATS_TOKEN;
    else process.env.STATS_TOKEN = previous;
  };

  try {
    delete process.env.STATS_TOKEN;
    const hidden = await fetch(`${base}/api/stats`);
    assert.equal(hidden.status, 404);
    assert.equal((await hidden.json()).days, undefined);

    process.env.STATS_TOKEN = TOKEN;
    const missing = await fetch(`${base}/api/stats`);
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get("www-authenticate"), /Basic/);
    const wrong = await fetch(`${base}/api/stats`, { headers: { authorization: "Bearer otro" } });
    assert.equal(wrong.status, 401);
    const viaQuery = await fetch(`${base}/api/stats?token=${TOKEN}`);
    assert.equal(viaQuery.status, 401);

    const view = {
      event: "pageview",
      path: "/en/",
      lang: "en",
      ref: "hn",
      referrer: "https://news.ycombinator.com/item?id=1",
    };
    const counted = { "cf-connecting-ip": IP, "user-agent": AGENT };
    const ok = await post(base, view, counted);
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), "*");
    assert.equal(await ok.text(), "");

    const direct = await post(
      base,
      { ...view, ref: "no-es-un-canal", referrer: "https://203.0.113.8/secreto" },
      counted,
    );
    assert.equal(direct.status, 204);

    const scan = await post(
      base,
      { event: "scan", path: "/playground/", lang: "es", ref: "reddit", referrer: "" },
      counted,
    );
    assert.equal(scan.status, 204);
    const widget = await post(
      base,
      { event: "widget", path: "/host/page", lang: "es", referrer: "blog.example" },
      counted,
    );
    assert.equal(widget.status, 204);

    const optedOut = await post(base, view, { dnt: "1" });
    assert.equal(optedOut.status, 204);
    const gpc = await post(base, view, { "sec-gpc": "1" });
    assert.equal(gpc.status, 204);

    const invalid = await post(base, { event: "pageview", path: "/wp-admin", lang: "es" });
    assert.equal(invalid.status, 400);
    const badLang = await post(base, { event: "pageview", path: "/", lang: "fr" });
    assert.equal(badLang.status, 400);
    const empty = await post(base, "");
    assert.equal(empty.status, 400);
    const huge = await post(base, `{"event":"pageview","path":"${"a".repeat(2000)}"}`);
    assert.equal(huge.status, 413);

    const stats = await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(stats.status, 200);
    assert.equal(stats.headers.get("cache-control"), "no-store");
    const body = await stats.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.storage, { backend: "memory", durable: false });
    assert.equal(body.days[7].totals.pageview, 2);
    assert.equal(body.days[7].totals.scan, 1);
    assert.equal(body.days[7].totals.widget, 1);
    assert.equal(body.days[30].totals.pageview, 2);
    assert.equal(body.days[7].uniques, 1);
    assert.equal(body.days[7].byRef.find((row) => row.ref === "hn").pageview, 1);
    assert.equal(body.days[7].byRef.find((row) => row.ref === "direct").pageview, 1);
    assert.equal(body.days[7].byReferrer.find((row) => row.host === "news.ycombinator.com").pageview, 1);
    assert.equal(body.days[7].byPath.find((row) => row.path === "/embed").widget, 1);

    const dumped = JSON.stringify(body);
    assert.equal(dumped.includes(IP), false);
    assert.equal(dumped.includes("203.0.113.8"), false);
    assert.equal(dumped.includes(AGENT), false);
    assert.equal(dumped.includes(TOKEN), false);

    const basic = Buffer.from(`vista:${TOKEN}`).toString("base64");
    const html = await fetch(`${base}/api/stats`, {
      headers: { authorization: `Basic ${basic}`, accept: "text/html" },
    });
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type"), /text\/html/);
    assert.equal(html.headers.get("x-robots-tag"), "noindex, nofollow");
    const page = await html.text();
    assert.match(page, /Últimos 7 días/);
    assert.match(page, /Últimos 30 días/);
    assert.match(page, /news\.ycombinator\.com/);
    assert.match(page, />hn</);
    assert.equal(page.includes(TOKEN), false);
    assert.equal(page.includes(IP), false);

    const header = await fetch(`${base}/api/stats`, { headers: { "x-stats-token": TOKEN } });
    assert.equal(header.status, 200);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/collect limita ráfagas por IP", async () => {
  const server = await startServer({
    port: 0,
    logger: silent,
    analyticsStore: createAnalyticsStore({ restUrl: "", restToken: "", secret: "otra-sal", logger: silent }),
    analyticsRateLimit: createRateLimiter({ limit: 2, windowMs: 60_000 }),
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { event: "pageview", path: "/", lang: "es", ref: "x" };

  try {
    assert.equal((await post(base, body)).status, 204);
    assert.equal((await post(base, body)).status, 204);
    const limited = await post(base, body);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
