import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildShareHash,
  buildShareLink,
  buildWidgetSnippet,
  decodeAnyToken,
  decodeShareToken,
  decodeShortToken,
  encodeSeed,
  encodeShareToken,
  encodeShortToken,
  readShareHash,
  DEFAULT_WIDGET_BASE,
} from "../src/embed.js";

const SEED = {
  metadata: {
    detectedVibe: "Electrónica cálida ☕",
    explanation: 'Textura suave, con "comillas" y\nsaltos de línea.',
    url: "https://ejemplo.test/",
  },
  uiTheme: { backgroundColor: "#F7F3EC", accentColor: "#8C6A43", textColor: "#1E1B16" },
};

const FULL_SEED = JSON.parse(readFileSync(new URL("../presets/editorial.json", import.meta.url), "utf8"));

function decode(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

test("encodeSeed conserva el JSON con acentos, emojis y comillas", () => {
  assert.deepEqual(decode(encodeSeed(SEED)), SEED);
});

test("el data-seed solo usa caracteres seguros dentro de un atributo", () => {
  assert.match(encodeSeed(SEED), /^[A-Za-z0-9+/]+={0,2}$/);
});

test("el snippet apunta al widget público e incrusta la semilla", () => {
  const snippet = buildWidgetSnippet(SEED);
  assert.match(snippet, new RegExp(`<script src="${DEFAULT_WIDGET_BASE}/widget.js"`));
  assert.match(snippet, /data-seed="([A-Za-z0-9+/]+={0,2})"/);
  assert.match(snippet, /\bdefer><\/script>/);

  const encoded = snippet.match(/data-seed="([^"]+)"/)[1];
  assert.deepEqual(decode(encoded), SEED);
});

test("el origen del snippet no duplica la barra final", () => {
  const snippet = buildWidgetSnippet(SEED, { base: "https://staging.test/" });
  assert.match(snippet, /src="https:\/\/staging\.test\/widget\.js"/);
  assert.doesNotMatch(snippet, /staging\.test\/\/widget/);
});

test("el snippet no rompe el HTML con </script> en los textos", () => {
  const snippet = buildWidgetSnippet({ ...SEED, metadata: { ...SEED.metadata, explanation: "</script><b>x</b>" } });
  assert.equal(snippet.match(/<\/script>/g).length, 1);
});

test("el formato antiguo sigue recuperando la semilla completa", () => {
  const hash = `#seed=${encodeShareToken(SEED)}`;
  assert.match(hash, /^#seed=[A-Za-z0-9_-]+$/);
  assert.deepEqual(readShareHash(hash), SEED);
  assert.deepEqual(decodeAnyToken(encodeShareToken(SEED)), SEED);
  assert.deepEqual(decodeShareToken(encodeShareToken(SEED)), SEED);
});

test("el enlace corto conserva música y tema pero omite la explicación", () => {
  const token = encodeShortToken(FULL_SEED);
  assert.match(token, /^~[A-Za-z0-9_-]+$/);
  assert.ok(token.length < 300, `el token mide ${token.length} caracteres`);

  const decoded = decodeShortToken(token);
  assert.equal(decoded.metadata.explanation, "");
  assert.equal(decoded.metadata.url, FULL_SEED.metadata.url);
  assert.equal(decoded.metadata.detectedVibe, FULL_SEED.metadata.detectedVibe);
  assert.deepEqual(decoded.uiTheme, FULL_SEED.uiTheme);
  assert.deepEqual(decoded.musicalParams, FULL_SEED.musicalParams);
  assert.deepEqual(decoded.synthConfig, FULL_SEED.synthConfig);

  const restored = readShareHash(buildShareHash(FULL_SEED));
  assert.equal(restored.metadata.explanation, "");
  assert.deepEqual(restored.musicalParams, FULL_SEED.musicalParams);
});

test("readShareHash ignora fragmentos sin semilla y rechaza tokens corruptos", () => {
  assert.equal(readShareHash(""), null);
  assert.equal(readShareHash("#otra-cosa"), null);
  assert.equal(readShareHash("#seed=%%%"), null);
  assert.throws(() => decodeShareToken("%%%"), /inválido/);
  assert.throws(() => decodeShareToken("bm8tZXMtanNvbg"), SyntaxError);
  assert.throws(() => decodeAnyToken("~%%%"), /inválido/);
});

test("buildShareLink apunta a la vista previa del backend y respeta el idioma", () => {
  const es = buildShareLink(FULL_SEED, { origin: "https://vibedom.onrender.com/" });
  assert.match(es, /^https:\/\/vibedom\.onrender\.com\/s\/~[A-Za-z0-9_-]+$/);
  const decoded = decodeAnyToken(es.split("/s/")[1]);
  assert.equal(decoded.metadata.explanation, "");
  assert.deepEqual(decoded.musicalParams, FULL_SEED.musicalParams);

  const en = buildShareLink(FULL_SEED, { origin: "https://vibedom.onrender.com", lang: "en" });
  assert.match(en, /\?l=en$/);
  assert.equal(buildShareLink(FULL_SEED, { origin: "" }), null);
});

test("el enlace de un preset real cabe en una URL normal", () => {
  const preset = JSON.parse(readFileSync(new URL("../presets/editorial.json", import.meta.url), "utf8"));
  const url = `https://vibedom.dev/playground/${buildShareHash(preset)}`;
  assert.ok(url.length < 500, `el enlace mide ${url.length} caracteres`);
  const restored = readShareHash(buildShareHash(preset));
  assert.equal(restored.metadata.explanation, "");
  assert.deepEqual(restored.musicalParams, preset.musicalParams);
  assert.deepEqual(restored.synthConfig, preset.synthConfig);

  const preview = buildShareLink(preset, { origin: "https://vibedom.onrender.com" });
  assert.ok(preview.length < 500, `la vista previa mide ${preview.length} caracteres`);
});
