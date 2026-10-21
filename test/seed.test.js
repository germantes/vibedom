import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SeedError, normalizeSeed } from "../src/engine/seed.js";

const presetsDir = new URL("../presets/", import.meta.url);
const load = (file) => JSON.parse(readFileSync(new URL(file, presetsDir), "utf8"));
const presetFiles = readdirSync(presetsDir).filter((f) => f.endsWith(".json"));
const base = () => structuredClone(load("cyberpunk.json"));

test("los presets incluidos cumplen el contrato sin recortes", () => {
  assert.ok(presetFiles.length >= 3);
  for (const file of presetFiles) {
    const preset = load(file);
    assert.deepEqual(normalizeSeed(preset), preset, file);
  }
});

test("el ejemplo literal de la spec es válido", () => {
  const spec = base();
  Object.assign(spec.musicalParams, { bpm: 75, rootNote: "D", scale: "phrygian", octave: 3 });
  Object.assign(spec.synthConfig.pad, { waveform: "sawtooth", attack: 2.5, release: 4.0, filterFreq: 600 });
  Object.assign(spec.synthConfig.interactivity, { scrollTarget: "filterFreq", scrollMultiplier: 2.5, hoverNoteTrigger: true });
  assert.doesNotThrow(() => normalizeSeed(spec));
});

test("números fuera de rango se recortan, no rompen", () => {
  const seed = base();
  seed.musicalParams.bpm = 400;
  seed.musicalParams.octave = 3.6;
  seed.synthConfig.arp.density = -1;
  seed.synthConfig.pad.filterFreq = 50000;
  const out = normalizeSeed(seed);
  assert.equal(out.musicalParams.bpm, 140);
  assert.equal(out.musicalParams.octave, 4);
  assert.equal(out.synthConfig.arp.density, 0);
  assert.equal(out.synthConfig.pad.filterFreq, 12000);
});

test("reporta todos los errores estructurales a la vez", () => {
  const seed = base();
  seed.musicalParams.scale = "blues";
  seed.musicalParams.rootNote = "H";
  seed.uiTheme.accentColor = "green";
  seed.synthConfig.pad.attack = "lento";
  delete seed.synthConfig.interactivity;
  try {
    normalizeSeed(seed);
    assert.fail("debería lanzar");
  } catch (err) {
    assert.ok(err instanceof SeedError);
    const paths = err.issues.map((i) => i.split(":")[0]);
    for (const p of [
      "musicalParams.scale",
      "musicalParams.rootNote",
      "uiTheme.accentColor",
      "synthConfig.pad.attack",
      "synthConfig.interactivity.scrollTarget",
      "synthConfig.interactivity.hoverNoteTrigger",
    ]) {
      assert.ok(paths.includes(p), `falta ${p} en ${paths}`);
    }
  }
});

test("rechaza entrada que no es objeto", () => {
  assert.throws(() => normalizeSeed(null), SeedError);
  assert.throws(() => normalizeSeed("{}"), SeedError);
});
