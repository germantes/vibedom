import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSeedText, seedFileName, serializeSeed } from "../src/seed-io.js";
import { normalizeSeed } from "../src/engine/seed.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const preset = JSON.parse(readFileSync(`${ROOT}presets/cyberpunk.json`, "utf8"));

test("serializeSeed devuelve JSON legible que recupera la semilla", () => {
  const text = serializeSeed(preset);
  assert.equal(JSON.parse(text).metadata.detectedVibe, preset.metadata.detectedVibe);
  assert.match(text, /\n {2}"/);
});

test("parseSeedText acepta una semilla exportada y la devuelve saneada", () => {
  const seed = parseSeedText(serializeSeed(preset));
  assert.equal(seed.metadata.detectedVibe, preset.metadata.detectedVibe);
  assert.equal(seed.musicalParams.bpm, preset.musicalParams.bpm);
});

test("parseSeedText lanza con texto que no es JSON", () => {
  assert.throws(() => parseSeedText("no soy json"), SyntaxError);
});

test("parseSeedText lanza con JSON que no cumple el contrato", () => {
  assert.throws(() => parseSeedText('{"metadata":"una cadena"}'));
  assert.throws(() => parseSeedText("{}"));
});

test("parseSeedText recorta números fuera de rango como normalizeSeed", () => {
  const raw = JSON.stringify({ ...structuredClone(preset), musicalParams: { ...preset.musicalParams, bpm: 9999 } });
  const seed = parseSeedText(raw);
  const expected = normalizeSeed(JSON.parse(raw));
  assert.equal(seed.musicalParams.bpm, expected.musicalParams.bpm);
});

test("seedFileName usa el host de la semilla escaneada", () => {
  const scanned = { ...structuredClone(preset), metadata: { ...preset.metadata, url: "https://www.stripe.com/es" } };
  assert.equal(seedFileName(scanned), "vibedom-stripe.com.json");
});

test("seedFileName cae al vibe cuando no hay URL, y a vibedom si tampoco", () => {
  const scanned = { ...structuredClone(preset), metadata: { url: "no-url", detectedVibe: "Editorial Sobrio" } };
  assert.equal(seedFileName(scanned), "vibedom-editorial-sobrio.json");

  const bare = { ...structuredClone(preset), metadata: { url: null } };
  assert.match(seedFileName(bare), /^vibedom-.*\.json$/);
  assert.equal(seedFileName(null), "vibedom-vibedom.json");
});
