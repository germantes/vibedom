import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../src/backend/server.js";
import { createHitStore } from "../src/backend/hit-store.js";
import { createRateLimiter } from "../src/backend/rate-limit.js";

const silent = { log() {}, warn() {}, error() {} };

let server;
let base;
let blockHits = false;
let hitStore;

describe("POST /api/hit y GET /api/stats", { concurrency: 1 }, () => {
before(async () => {
  hitStore = createHitStore({ restUrl: "", restToken: "", logger: silent });
  server = await startServer({
    port: 0,
    logger: silent,
    hitStore,
    hitRateLimit: (req) => {
      if (blockHits) return { ok: false, remaining: 0, retryAfter: 9 };
      return createRateLimiter({ limit: 100 })(req);
    },
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function hitBody(overrides = {}) {
  return JSON.stringify({
    path: "/",
    lang: "es",
    ref: "hn",
    referrer: "news.ycombinator.com",
    ...overrides,
  });
}

test("POST /api/hit cuenta la visita y no guarda la IP ni la búsqueda", async () => {
  blockHits = false;
  const res = await fetch(`${base}/api/hit`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: "https://vibedom.dev",
    },
    body: hitBody({ ip: "203.0.113.9", ref: "hn", path: "/sound-tests/" }),
  });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://vibedom.dev");
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  assert.equal(res.headers.get("cache-control"), "no-store");

  const previous = process.env.STATS_TOKEN;
  process.env.STATS_TOKEN = "token-de-prueba";
  try {
    const stats = await fetch(`${base}/api/stats?days=1`, {
      headers: { authorization: "Bearer token-de-prueba" },
    });
    assert.equal(stats.status, 200);
    const body = await stats.json();
    assert.equal(body.ok, true);
    assert.equal(body.backend, "memory");
    assert.equal(body.durable, false);
    const row = body.rows.find((item) => item.path === "/sound-tests/" && item.ref === "hn");
    assert.ok(row);
    assert.equal(row.referrer, "news.ycombinator.com");
    assert.equal(row.count >= 1, true);
    assert.equal(JSON.stringify(body).includes("203.0.113.9"), false);
    assert.equal(Object.hasOwn(row, "ip"), false);
    assert.equal(Object.hasOwn(row, "lang"), false);
  } finally {
    if (previous === undefined) delete process.env.STATS_TOKEN;
    else process.env.STATS_TOKEN = previous;
  }
});

test("POST /api/hit valida el cuerpo y aplica el límite", async () => {
  blockHits = false;
  const bad = await fetch(`${base}/api/hit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://vibedom.dev" },
    body: JSON.stringify({ path: "/../secret", lang: "es", ref: "hn", referrer: "" }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /inválida/);

  const broken = await fetch(`${base}/api/hit`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{nope",
  });
  assert.equal(broken.status, 400);

  const direct = await fetch(`${base}/api/hit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: hitBody({ ref: "", referrer: "https://www.google.com/search?q=vibedom", path: "/en/", lang: "en" }),
  });
  assert.equal(direct.status, 204);

  blockHits = true;
  const limited = await fetch(`${base}/api/hit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: hitBody(),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "9");
  blockHits = false;
});

test("GET /api/stats exige STATS_TOKEN y no lo acepta en la query", async () => {
  const previous = process.env.STATS_TOKEN;
  try {
    delete process.env.STATS_TOKEN;
    const disabled = await fetch(`${base}/api/stats`);
    assert.equal(disabled.status, 404);

    process.env.STATS_TOKEN = "secreto-stats";
    const missing = await fetch(`${base}/api/stats`);
    assert.equal(missing.status, 401);
    const wrong = await fetch(`${base}/api/stats`, { headers: { authorization: "Bearer otro" } });
    assert.equal(wrong.status, 401);
    const viaQuery = await fetch(`${base}/api/stats?token=secreto-stats&days=7`);
    assert.equal(viaQuery.status, 401);

    const header = await fetch(`${base}/api/stats?days=no`, {
      headers: { "x-stats-token": "secreto-stats" },
    });
    assert.equal(header.status, 400);

    const ok = await fetch(`${base}/api/stats?days=7`, {
      headers: { "x-stats-token": "secreto-stats" },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.days, 7);
    assert.equal(typeof body.total, "number");
    assert.ok(Array.isArray(body.byRef));

    const head = await fetch(`${base}/api/stats`, {
      method: "HEAD",
      headers: { authorization: "Bearer secreto-stats" },
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    if (previous === undefined) delete process.env.STATS_TOKEN;
    else process.env.STATS_TOKEN = previous;
  }
});
});
