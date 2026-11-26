import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COLLECT_PATHS,
  REF_CODES,
  buildCollectPayload,
  collectEndpoint,
  normalizePath,
  normalizeRef,
  parseCollect,
  referrerHost,
  trackingOptedOut,
} from "../src/analytics-core.js";
import { renderStatsPage } from "../src/backend/stats-page.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("el referrer se queda en el dominio y se descartan IP, ruta y esquemas raros", () => {
  assert.equal(referrerHost("https://www.Reddit.com/r/webdev?x=1"), "reddit.com");
  assert.equal(referrerHost("https://news.ycombinator.com/item?id=1"), "news.ycombinator.com");
  assert.equal(referrerHost("https://t.co/abc"), "t.co");
  assert.equal(referrerHost("news.ycombinator.com"), "news.ycombinator.com");
  assert.equal(referrerHost("https://203.0.113.8/secret"), "");
  assert.equal(referrerHost("https://user:pass@evil.example/a"), "evil.example");
  assert.equal(referrerHost("android-app://com.google.app"), "");
  assert.equal(referrerHost("http://localhost/playground"), "");
  assert.equal(referrerHost(""), "");
});

test("la ruta tiene que ser una página publicada", () => {
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/en"), "/en/");
  assert.equal(normalizePath("/playground/en/index.html"), "/playground/en/");
  assert.equal(normalizePath("/embed"), "/embed");
  assert.equal(normalizePath("/wp-admin"), null);
  assert.equal(normalizePath("https://vibedom.dev/"), null);
  assert.equal(normalizePath("/../etc/passwd"), null);
  assert.equal(normalizePath("/%2e%2e/secret"), null);
  assert.ok(COLLECT_PATHS.includes("/privacidad/"));
  assert.ok(COLLECT_PATHS.includes("/en/privacy/"));
});

test("el ref desconocido cuenta como direct y solo es/en pasan", () => {
  for (const code of REF_CODES) assert.equal(normalizeRef(code), code);
  assert.equal(normalizeRef("HN"), "hn");
  assert.equal(normalizeRef(""), "direct");
  assert.equal(normalizeRef("DROP TABLE"), "direct");
  assert.equal(normalizeRef("xtra"), "direct");

  assert.equal(parseCollect({ event: "pageview", path: "/", lang: "fr", ref: "hn" }), null);
  assert.equal(parseCollect({ event: "nope", path: "/", lang: "es" }), null);
  assert.equal(parseCollect({ event: "pageview", path: "/embed", lang: "es" }), null);
});

test("Do Not Track y Global Privacy Control cancelan el envío", () => {
  assert.equal(trackingOptedOut({ doNotTrack: "1" }, {}), true);
  assert.equal(trackingOptedOut({ doNotTrack: "yes" }, {}), true);
  assert.equal(trackingOptedOut({ doNotTrack: "0", globalPrivacyControl: true }, {}), true);
  assert.equal(trackingOptedOut({ doNotTrack: null }, { doNotTrack: "1" }), true);
  assert.equal(trackingOptedOut({ doNotTrack: "unspecified" }, {}), false);
  assert.equal(trackingOptedOut({}, {}), false);
});

test("el aviso de página reduce el referrer al host y arma el cuerpo", () => {
  assert.deepEqual(
    buildCollectPayload({
      event: "pageview",
      path: "/en",
      lang: "en",
      ref: "ph",
      referrer: "https://www.producthunt.com/posts/vibedom?ref=1",
    }),
    {
      event: "pageview",
      path: "/en/",
      lang: "en",
      ref: "ph",
      referrer: "producthunt.com",
    },
  );
  assert.equal(buildCollectPayload({ event: "pageview", path: "/no-existe", lang: "es" }), null);
  assert.equal(buildCollectPayload({ event: "widget", path: "/cualquier-cosa", lang: "es" }).path, "/embed");
});

test("en local el aviso no sale hacia producción", () => {
  const local = collectEndpoint({ hostname: "localhost", origin: "http://localhost:3000" }, "https://vibedom.onrender.com");
  assert.equal(local.href, "http://localhost:3000/api/collect");

  const site = collectEndpoint(
    { hostname: "vibedom.dev", origin: "https://vibedom.dev" },
    "https://vibedom.onrender.com",
  );
  assert.equal(site.href, "https://vibedom.onrender.com/api/collect");
});

test("la página de stats escapa el HTML y no pide assets", () => {
  const window = {
    days: 7,
    from: "2026-11-20",
    to: "2026-11-26",
    totals: { pageview: 1, scan: 0, widget: 0 },
    uniques: 1,
    byRef: [],
    byReferrer: [{ host: "<script>", pageview: 1, scan: 0, widget: 0, total: 1 }],
    byPath: [],
  };
  const html = renderStatsPage({
    storage: { backend: "memory", durable: false },
    days: { 7: window, 30: { ...window, days: 30 } },
  });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /memoria de este proceso/);
  assert.doesNotMatch(html, /src=/);
});

test("las páginas que ve la gente cargan el aviso, y la documentación lista los ref", () => {
  for (const file of [
    "src/landing/main.js",
    "src/demo/main.js",
    "sound-tests/page.js",
    "src/docs/docs.js",
    "privacidad/index.html",
    "en/privacy/index.html",
  ]) {
    assert.match(read(file), /analytics\.js/, file);
  }
  assert.match(read("src/landing/main.js"), /track\("scan"\)/);
  assert.match(read("src/demo/main.js"), /track\("scan"\)/);
  const beacon = read("src/analytics.js").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(beacon, /localStorage|document\.cookie/);

  const readme = read("README.md");
  const marketing = read("MARKETING.md");
  const yaml = read("render.yaml");
  for (const code of REF_CODES) {
    assert.match(readme, new RegExp(`ref=${code}(?:\\b|$)`));
    assert.match(marketing, new RegExp(`ref=${code}(?:\\b|$)`));
  }
  assert.match(readme, /STATS_TOKEN/);
  assert.match(marketing, /STATS_TOKEN/);
  assert.match(yaml, /key: STATS_TOKEN\n {8}sync: false/);
  assert.doesNotMatch(yaml, /STATS_TOKEN[\s\S]{0,40}value:/);
});
