import { test } from "node:test";
import assert from "node:assert/strict";

import { composeLocalSeed } from "../src/backend/local-seed.js";
import { normalizeSeed } from "../src/engine/seed.js";
import { hexToRgb, luminance } from "../src/backend/scraper.js";

const DARK = {
  url: "https://studio.test/",
  title: "Studio",
  colors: { all: ["#101018", "#ff2d95", "#36f1cd", "#f4f1e8"], background: "#101018", isDark: true },
  fonts: { families: ["jetbrains mono"], categories: ["monospace"] },
  hasAnimations: true,
  hasTransitions: true,
};

const LIGHT = {
  url: "https://editorial.test/",
  title: "Editorial",
  colors: { all: ["#fbf7ef", "#1d1a16", "#b08d57"], background: "#fbf7ef", isDark: false },
  fonts: { families: ["iowan old style", "georgia"], categories: ["serif"] },
  hasAnimations: false,
  hasTransitions: false,
};

function contrast(a, b) {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("la semilla local es determinista y cumple el contrato", () => {
  const first = composeLocalSeed(DARK, { lang: "es" });
  const second = composeLocalSeed(DARK, { lang: "es" });
  assert.deepEqual(first, second);
  assert.deepEqual(normalizeSeed(first), first);
});

test("el idioma cambia la copia pero no la música", () => {
  const es = composeLocalSeed(DARK, { lang: "es" });
  const en = composeLocalSeed(DARK, { lang: "en" });

  assert.deepEqual(es.musicalParams, en.musicalParams);
  assert.deepEqual(es.synthConfig, en.synthConfig);
  assert.notEqual(es.metadata.detectedVibe, en.metadata.detectedVibe);
  assert.notEqual(es.metadata.explanation, en.metadata.explanation);
  assert.match(en.metadata.explanation, /BPM/);
  assert.match(es.metadata.explanation, /BPM/);
});

test("un fondo oscuro y saturado suena grave, cerrado y con sierras", () => {
  const seed = composeLocalSeed(DARK);
  assert.equal(seed.uiTheme.fontFamily, "monospace");
  assert.ok(seed.musicalParams.bpm <= 90);
  assert.ok(seed.synthConfig.pad.filterFreq < 1600);
  assert.ok(["sawtooth", "square"].includes(seed.synthConfig.pad.waveform));
  assert.ok(seed.synthConfig.effects.chorusDepth >= 0.3);
  assert.equal(seed.synthConfig.interactivity.scrollTarget, "filterFreq");
});

test("un fondo claro y serif suena abierto y cálido", () => {
  const seed = composeLocalSeed(LIGHT);
  assert.equal(seed.uiTheme.fontFamily, "serif");
  assert.ok(seed.synthConfig.pad.filterFreq >= 1000);
  assert.ok(["sine", "triangle"].includes(seed.synthConfig.pad.waveform));
  assert.ok(seed.synthConfig.effects.reverbWet >= 0.4);
  assert.ok(seed.synthConfig.effects.reverbDecay >= 6);
});

test("el tema local es legible y el acento no se confunde con el fondo", () => {
  for (const signals of [DARK, LIGHT, { url: "https://sin-css.test/" }]) {
    const seed = composeLocalSeed(signals);
    assert.match(seed.uiTheme.backgroundColor, /^#[0-9a-f]{6}$/);
    assert.match(seed.uiTheme.accentColor, /^#[0-9a-f]{6}$/);
    assert.match(seed.uiTheme.textColor, /^#[0-9a-f]{6}$/);
    assert.notEqual(seed.uiTheme.accentColor, seed.uiTheme.backgroundColor);
    assert.ok(contrast(seed.uiTheme.textColor, seed.uiTheme.backgroundColor) >= 4.4);
  }
});

test("webs distintas producen semillas distintas", () => {
  const a = composeLocalSeed(DARK);
  const b = composeLocalSeed({ ...DARK, url: "https://otra.test/" });
  const changed =
    a.musicalParams.rootNote !== b.musicalParams.rootNote ||
    a.musicalParams.scale !== b.musicalParams.scale ||
    a.musicalParams.octave !== b.musicalParams.octave ||
    a.synthConfig.pad.waveform !== b.synthConfig.pad.waveform;
  assert.ok(changed);
});

test("sin señales de color sigue generando una semilla válida", () => {
  const seed = composeLocalSeed({ url: "https://vacia.test/" }, { lang: "en" });
  assert.match(seed.metadata.explanation, /background/);
  assert.ok(seed.synthConfig.pad.filterFreq > 0);
  assert.ok(seed.musicalParams.bpm >= 44 && seed.musicalParams.bpm <= 104);
});
