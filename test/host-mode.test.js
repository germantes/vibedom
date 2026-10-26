import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyHost, resolveApiBase } from "../src/host-mode.js";

const GITHUB = { protocol: "https:", hostname: "germantes.github.io", origin: "https://germantes.github.io" };
const DOMAIN = { protocol: "https:", hostname: "vibedom.dev", origin: "https://vibedom.dev" };
const RENDER = { protocol: "https:", hostname: "vibedom.onrender.com", origin: "https://vibedom.onrender.com" };
const LOCAL = { protocol: "http:", hostname: "localhost", origin: "http://localhost:3000" };

test("resolveApiBase acepta http(s), quita barras finales y rechaza el resto", () => {
  assert.equal(resolveApiBase("https://vibedom.onrender.com/"), "https://vibedom.onrender.com");
  assert.equal(resolveApiBase("  http://localhost:3000//  "), "http://localhost:3000");
  assert.equal(resolveApiBase(""), "");
  assert.equal(resolveApiBase(undefined), "");
  assert.equal(resolveApiBase("ftp://nope"), "");
  assert.equal(resolveApiBase("no-es-una-url"), "");
});

test("GitHub Pages y el dominio propio son hosts estáticos", () => {
  for (const ctx of [GITHUB, DOMAIN]) {
    const host = classifyHost({ ...ctx, rawApiBase: "https://vibedom.onrender.com" });
    assert.equal(host.staticHost, true, ctx.hostname);
    assert.equal(host.externalApi, true);
  }
});

test("un backend declarado en otro origen implica host estático", () => {
  const host = classifyHost({ ...LOCAL, rawApiBase: "https://vibedom.onrender.com" });
  assert.equal(host.staticHost, true);
  assert.equal(host.apiOrigin, "https://vibedom.onrender.com");
});

test("Render sirve la API en el mismo origen: no es estático", () => {
  const host = classifyHost({ ...RENDER, rawApiBase: "https://vibedom.onrender.com" });
  assert.equal(host.staticHost, false);
  assert.equal(host.externalApi, true);
});

test("local sin meta usa la API relativa y puede escanear", () => {
  const host = classifyHost({ ...LOCAL, rawApiBase: "" });
  assert.equal(host.staticHost, false);
  assert.equal(host.externalApi, false);
});

test("GitHub Pages o dominio propio sin meta no pueden escanear", () => {
  for (const ctx of [GITHUB, DOMAIN]) {
    const host = classifyHost({ ...ctx, rawApiBase: "" });
    assert.equal(host.staticHost, true);
    assert.equal(host.externalApi, false);
  }
});

test("file: siempre es estático", () => {
  const host = classifyHost({
    protocol: "file:",
    hostname: "",
    origin: "null",
    rawApiBase: "https://vibedom.onrender.com",
  });
  assert.equal(host.staticHost, true);
});
