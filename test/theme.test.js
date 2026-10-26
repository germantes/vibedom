import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accentFor,
  contrastRatio,
  mixHex,
  normalizeHex,
  onColorFor,
  relativeLuminance,
  textFor,
  toRgb,
  withAlpha,
} from "../src/landing/theme.js";

test("normalizeHex acepta 3, 4, 6 y 8 dígitos y descarta el alfa", () => {
  assert.equal(normalizeHex("#abc"), "#aabbcc");
  assert.equal(normalizeHex("#abcd"), "#aabbcc");
  assert.equal(normalizeHex("#AABBCC"), "#aabbcc");
  assert.equal(normalizeHex("#aabbccdd"), "#aabbcc");
  assert.equal(normalizeHex("aabbcc"), "#aabbcc");
  assert.equal(normalizeHex(""), null);
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex("#12345"), null);
});

test("toRgb y luminancia relativa", () => {
  assert.deepEqual(toRgb("#00ff66"), { r: 0, g: 255, b: 102 });
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.ok(relativeLuminance("#808080") > 0.2 && relativeLuminance("#808080") < 0.25);
});

test("contraste WCAG de referencia", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#ffffff", "#ffffff") - 1) < 0.001);
  assert.equal(contrastRatio("#000000", "#000000"), 1);
});

test("textFor respeta el color preferido si es legible", () => {
  assert.equal(textFor("#ffffff", "#1e1b16"), "#1e1b16");
  assert.equal(textFor("#0a0a0a", "#e6ffe9"), "#e6ffe9");
});

test("textFor corrige un texto que no llega a 4.5:1", () => {
  const light = textFor("#ffffff", "#eeeeee");
  assert.equal(light, "#0a0a0c");
  const dark = textFor("#0a0a0a", "#222222");
  assert.equal(dark, "#f4f1e8");
});

test("textFor elige el mejor extremo en fondos intermedios", () => {
  const result = textFor("#777777", "#808080");
  assert.ok(result === "#0a0a0c" || result === "#f4f1e8");
  assert.ok(contrastRatio(result, "#777777") > 3.5);
});

test("onColorFor devuelve el texto que más contrasta con el acento", () => {
  assert.equal(onColorFor("#00ff66"), "#0a0a0c");
  assert.equal(onColorFor("#8c6a43"), "#ffffff");
  assert.equal(onColorFor("#000000"), "#ffffff");
  assert.equal(onColorFor("#ffffff"), "#0a0a0c");
});

test("accentFor mantiene un acento visible y corrige uno pálido", () => {
  assert.equal(accentFor("#00ff66", "#0a0a0a"), "#00ff66");
  assert.equal(accentFor("#8c6a43", "#f7f3ec"), "#8c6a43");

  const pale = accentFor("#fffde0", "#ffffff");
  assert.notEqual(pale, "#fffde0");
  assert.ok(contrastRatio(pale, "#ffffff") >= 3);
});

test("accentFor acepta un mínimo más alto para texto", () => {
  const accent = "#8c6a43";
  const bg = "#f7f3ec";
  const shape = accentFor(accent, bg, 3);
  const ink = accentFor(accent, bg, 4.5);
  assert.ok(contrastRatio(shape, bg) >= 3);
  assert.ok(contrastRatio(ink, bg) >= 4.5);
  assert.ok(contrastRatio(ink, bg) > contrastRatio(shape, bg));
});

test("accentFor devuelve null si el acento no es un hex", () => {
  assert.equal(accentFor("gold", "#000000"), null);
});

test("mixHex interpola y respeta los extremos", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
});

test("withAlpha construye rgba para glows", () => {
  assert.equal(withAlpha("#00ff66", 0.2), "rgba(0, 255, 102, 0.2)");
  assert.equal(withAlpha("nope", 0.5), "rgba(0, 0, 0, 0.5)");
});
