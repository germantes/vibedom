import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const widget = readFileSync(new URL("../widget.js", import.meta.url), "utf8");
const player = readFileSync(new URL("../widget-player.js", import.meta.url), "utf8");

test("widget.js pesa menos de 5 KB y compila como script clásico", () => {
  const bytes = Buffer.byteLength(widget, "utf8");
  assert.ok(bytes <= 5 * 1024, `widget.js pesa ${bytes} bytes`);
  assert.doesNotThrow(() => new Function(widget));
});

test("el botón vive en Shadow DOM y no toca el CSS de la web anfitriona", () => {
  assert.match(widget, /attachShadow\(\{\s*mode:\s*"open"\s*\}\)/);
  assert.match(widget, /:host\{all:initial\}/);
  assert.match(widget, /aria-pressed/);
  assert.match(widget, /prefers-reduced-motion/);
});

test("el motor y Tone.js se cargan solo al pulsar", () => {
  assert.match(widget, /import\(base \+ "widget-player\.js"\)/);
  assert.doesNotMatch(widget, /tone@/i);
  assert.doesNotMatch(player, /^import .*tone/im);
  assert.match(player, /await import\(TONE_URL\)/);
  assert.match(player, /createSoundscape/);
  assert.doesNotMatch(widget, /document\.write/);
});

test("el widget acepta un texto propio y detecta el idioma de la página", () => {
  assert.match(widget, /data-label/);
  assert.match(widget, /document\.documentElement\.lang/);
});
