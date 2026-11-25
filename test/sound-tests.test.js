import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeSeed } from "../src/engine/seed.js";
import { buildShareHash, readShareHash } from "../src/embed.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const ORDER = [
  "stripe",
  "apple",
  "wikipedia",
  "nike",
  "spotify",
  "airbnb",
  "figma",
  "linear",
  "vercel",
  "github",
];

function readSeed(slug, lang) {
  const path = `${ROOT}sound-tests/${slug}.${lang}.json`;
  assert.ok(existsSync(path), `falta ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

test("todas las semillas de sound-tests cumplen el contrato en ambos idiomas", () => {
  for (const slug of ORDER) {
    for (const lang of ["es", "en"]) {
      const seed = normalizeSeed(readSeed(slug, lang));
      assert.ok(seed.metadata.detectedVibe.length > 3, `${slug}.${lang} sin vibe`);
      assert.ok(seed.metadata.explanation.length >= 20, `${slug}.${lang} sin explanation`);
      assert.equal(seed.metadata.source, undefined, `${slug}.${lang} es semilla local sin IA`);
    }
  }
});

test("las páginas de sound tests son estáticas, bilingües y completas", () => {
  for (const [file, canonical] of [
    ["sound-tests/index.html", "https://vibedom.dev/sound-tests/"],
    ["en/sound-tests/index.html", "https://vibedom.dev/en/sound-tests/"],
  ]) {
    const html = readFileSync(`${ROOT}${file}`, "utf8");

    assert.ok(
      html.includes(`<link rel="canonical" href="${canonical}" />`),
      `${file} canonical incorrecto`,
    );
    assert.match(html, /hreflang="es" href="https:\/\/vibedom.dev\/sound-tests\/"/);
    assert.match(html, /hreflang="en" href="https:\/\/vibedom.dev\/en\/sound-tests\/"/);

    // Una tarjeta por web, con su botón de reproducción y su enlace al
    // playground con semilla corta.
    assert.equal((html.match(/class="st-card"/g) ?? []).length, ORDER.length);
    assert.equal((html.match(/class="st-play ghost"/g) ?? []).length, ORDER.length);
    const shareLinks = html.match(/href="\/playground\/(?:en\/)?#seed=~/g) ?? [];
    assert.equal(shareLinks.length, ORDER.length);

    // Nada de semillas de reserva publicadas.
    assert.doesNotMatch(html, /Variación de reserva|Failed scan/);
  }
});

test("el sitemap y la landing enlazan los sound tests", () => {
  const sitemap = readFileSync(`${ROOT}sitemap.xml`, "utf8");
  assert.match(sitemap, /<loc>https:\/\/vibedom\.dev\/sound-tests\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/vibedom\.dev\/en\/sound-tests\/<\/loc>/);

  assert.match(readFileSync(`${ROOT}index.html`, "utf8"), /href="sound-tests\/"/);
  assert.match(readFileSync(`${ROOT}en/index.html`, "utf8"), /href="sound-tests\/"/);
});

test("el token corto de cada semilla es reversible para el playground", () => {
  const raw = readSeed("stripe", "es");
  const hash = buildShareHash(raw);
  const restored = readShareHash(hash);
  assert.equal(restored.metadata.detectedVibe, raw.metadata.detectedVibe);
  assert.equal(restored.musicalParams.bpm, raw.musicalParams.bpm);
});
