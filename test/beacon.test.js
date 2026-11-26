import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildHit, resolveHitEndpoint, sendVisit, trackingOptOut } from "../src/beacon.js";

const beaconSource = readFileSync(new URL("../src/beacon.js", import.meta.url), "utf8");
const widgetSource = readFileSync(new URL("../widget.js", import.meta.url), "utf8");

const PAGES = [
  ["index.html", "src/beacon.js"],
  ["en/index.html", "../src/beacon.js"],
  ["que-suena-mi-web/index.html", "../src/beacon.js"],
  ["en/what-does-my-website-sound-like/index.html", "../../src/beacon.js"],
  ["playground/index.html", "../src/beacon.js"],
  ["playground/en/index.html", "../../src/beacon.js"],
  ["sound-tests/index.html", "../src/beacon.js"],
  ["en/sound-tests/index.html", "../../src/beacon.js"],
  ["widget/index.html", "../src/beacon.js"],
  ["en/widget/index.html", "../../src/beacon.js"],
  ["privacidad/index.html", "../src/beacon.js"],
  ["en/privacy/index.html", "../../src/beacon.js"],
];

test("trackingOptOut respeta DNT y Global Privacy Control", () => {
  assert.equal(trackingOptOut({ doNotTrack: "1" }), true);
  assert.equal(trackingOptOut({ doNotTrack: "yes" }), true);
  assert.equal(trackingOptOut({ msDoNotTrack: "1" }), true);
  assert.equal(trackingOptOut({ globalPrivacyControl: true }), true);
  assert.equal(trackingOptOut({ doNotTrack: "0", globalPrivacyControl: false }), false);
  assert.equal(trackingOptOut(undefined), false);
});

test("buildHit manda ruta, idioma, ref y solo el dominio del referrer", () => {
  assert.deepEqual(
    buildHit({
      pathname: "/en/",
      lang: "en-US",
      search: "?utm_source=Reddit&utm_campaign=launch",
      referrer: "https://www.reddit.com/r/webdev/comments/abc/title?x=1",
    }),
    { path: "/en/", lang: "en", ref: "reddit", referrer: "reddit.com" },
  );

  assert.equal(
    buildHit({
      pathname: "/",
      lang: "es",
      search: "?ref=hn&utm_source=reddit",
      referrer: "https://news.ycombinator.com/item?id=1",
    }).ref,
    "hn",
  );

  assert.equal(buildHit({ pathname: "/", lang: "es", search: "", referrer: "" }).ref, "");
  assert.equal(
    buildHit({ pathname: "/", lang: "es", search: "?ref=../x&utm_source=ph", referrer: "" }).ref,
    "ph",
  );
  assert.equal(buildHit({ pathname: "/../secret", lang: "es", search: "", referrer: "" }), null);
  assert.equal(
    buildHit({ pathname: "/", lang: "es", search: "", referrer: "https://8.8.8.8/a" }).referrer,
    "",
  );
});

test("resolveHitEndpoint no apunta a producción desde localhost y no sale de file:", () => {
  assert.equal(
    resolveHitEndpoint({
      protocol: "http:",
      hostname: "localhost",
      origin: "http://localhost:3000",
      apiMeta: "https://vibedom.onrender.com",
    }),
    "http://localhost:3000/api/hit",
  );
  assert.equal(
    resolveHitEndpoint({
      protocol: "https:",
      hostname: "vibedom.dev",
      origin: "https://vibedom.dev",
      apiMeta: "https://vibedom.onrender.com",
    }),
    "https://vibedom.onrender.com/api/hit",
  );
  assert.equal(
    resolveHitEndpoint({
      protocol: "https:",
      hostname: "vibedom.dev",
      origin: "https://vibedom.dev",
      apiMeta: "",
    }),
    "https://vibedom.onrender.com/api/hit",
  );
  assert.equal(
    resolveHitEndpoint({ protocol: "file:", hostname: "", origin: "null", apiMeta: "" }),
    "",
  );
});

test("sendVisit no llama a la red con DNT o GPC, y usa fetch keepalive si sendBeacon no puede", () => {
  const calls = [];
  const blocked = sendVisit({
    navigator: { doNotTrack: "1", sendBeacon: () => calls.push("beacon") },
    window: {},
    document: { documentElement: { lang: "es" }, referrer: "", querySelector: () => null },
    location: { protocol: "https:", hostname: "vibedom.dev", origin: "https://vibedom.dev", pathname: "/", search: "" },
    fetchImpl: () => calls.push("fetch"),
  });
  assert.equal(blocked, false);

  const gpc = sendVisit({
    navigator: {},
    window: { globalPrivacyControl: true },
    document: { documentElement: { lang: "es" }, referrer: "", querySelector: () => null },
    location: { protocol: "https:", hostname: "vibedom.dev", origin: "https://vibedom.dev", pathname: "/", search: "" },
    fetchImpl: () => calls.push("fetch"),
    beaconImpl: () => calls.push("beacon"),
  });
  assert.equal(gpc, false);
  assert.deepEqual(calls, []);

  let captured;
  const sent = sendVisit({
    navigator: { doNotTrack: "0" },
    window: {},
    document: {
      documentElement: { lang: "en" },
      referrer: "https://www.reddit.com/r/webdev/comments/abc",
      querySelector: () => ({ getAttribute: () => "https://vibedom.onrender.com/" }),
    },
    location: {
      protocol: "https:",
      hostname: "vibedom.dev",
      origin: "https://vibedom.dev",
      pathname: "/en/",
      search: "?utm_source=reddit",
    },
    beaconImpl: () => false,
    fetchImpl: (url, options) => {
      captured = { url, options };
    },
  });
  assert.equal(sent, true);
  assert.equal(captured.url, "https://vibedom.onrender.com/api/hit");
  assert.equal(captured.options.keepalive, true);
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(JSON.parse(captured.options.body), {
    path: "/en/",
    lang: "en",
    ref: "reddit",
    referrer: "reddit.com",
  });
  assert.doesNotMatch(captured.options.body, /comments/);
});

test("sendBeacon tiene prioridad y un fallo suyo cae a fetch", () => {
  const calls = [];
  const beaconed = sendVisit({
    navigator: {},
    window: {},
    document: { documentElement: { lang: "es" }, referrer: "", querySelector: () => null },
    location: {
      protocol: "https:",
      hostname: "vibedom.dev",
      origin: "https://vibedom.dev",
      pathname: "/",
      search: "?ref=x",
    },
    beaconImpl: (url, blob) => {
      calls.push(["beacon", url, blob.type]);
      return true;
    },
    fetchImpl: () => calls.push(["fetch"]),
  });
  assert.equal(beaconed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "beacon");
  assert.equal(calls[0][1], "https://vibedom.onrender.com/api/hit");
  assert.match(calls[0][2], /^text\/plain/i);

  const recovered = sendVisit({
    navigator: {},
    window: {},
    document: { documentElement: { lang: "es" }, referrer: "", querySelector: () => null },
    location: {
      protocol: "https:",
      hostname: "vibedom.dev",
      origin: "https://vibedom.dev",
      pathname: "/",
      search: "",
    },
    beaconImpl: () => {
      throw new Error("beacon roto");
    },
    fetchImpl: () => calls.push(["fetch"]),
  });
  assert.equal(recovered, true);
  assert.deepEqual(calls.at(-1), ["fetch"]);
});

test("la baliza no usa almacenamiento ni toca el widget, y pesa poco", () => {
  assert.ok(Buffer.byteLength(beaconSource, "utf8") < 6 * 1024);
  assert.doesNotMatch(beaconSource, /localStorage\.|sessionStorage\.|document\.cookie|indexedDB|getContext\(|fingerprint/i);
  assert.doesNotMatch(widgetSource, /\/api\/hit|src\/beacon/);
});

test("las páginas públicas cargan la baliza y el widget no", () => {
  for (const [page, src] of PAGES) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`<script type="module" src="${src.replaceAll("/", "\\/")}"></script>`), page);
  }
});
