// Genera las páginas «Sound tests» (ES y EN) desde las semillas de
// sound-tests/*.json. Cada tarjeta queda en el HTML —el contenido es
// indexable sin JavaScript— y el reproductor solo se carga al pulsar.
//
//   node scripts/build-sound-tests.mjs
//
// Tras re-escanear con scan-sound-tests.mjs, ejecutar esto y commitear.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeSeed } from "../src/engine/seed.js";
import { buildShareHash } from "../src/embed.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "sound-tests");
const TODAY = new Date().toISOString().slice(0, 10);

// Orden de vitrina, igual que en scan-sound-tests.mjs.
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

function loadSeeds(lang) {
  return ORDER.flatMap((slug) => {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(DATA, `${slug}.${lang}.json`), "utf8"));
    } catch {
      console.warn(`⚠ falta sound-tests/${slug}.${lang}.json`);
      return [];
    }
    const seed = normalizeSeed(raw);
    if (seed.metadata.source === "local") {
      console.warn(`⚠ ${slug}.${lang} es semilla local sin IA: no debe publicarse`);
    }
    return [{ slug, seed }];
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function stCard({ slug, seed }, lang) {
  const playHref = lang === "es" ? "/playground/" : "/playground/en/";
  const label = lang === "es" ? "Abrir en el playground" : "Open in the playground";
  const listen = lang === "es" ? "Escuchar" : "Play";
  const ui = seed.uiTheme;

  return `        <article class="st-card" style="--st-accent:${esc(ui.accentColor)};--st-bg:${esc(ui.backgroundColor)};--st-text:${esc(ui.textColor)}">
          <div class="st-head">
            <h3>${esc(slug.replace(/-/g, " "))}</h3>
            <button type="button" class="st-play ghost" data-slug="${esc(slug)}" data-lang="${lang}" aria-pressed="false">
              <span class="st-play-label">${listen}</span>
            </button>
          </div>
          <p class="st-vibe">${esc(seed.metadata.detectedVibe)}</p>
          <div class="st-swatches" aria-hidden="true">
            <i style="background:${esc(ui.backgroundColor)}"></i>
            <i style="background:${esc(ui.accentColor)}"></i>
            <i style="background:${esc(ui.textColor)}"></i>
          </div>
          <p class="st-explain">${esc(seed.metadata.explanation)}</p>
          <div class="st-meta">
            <span>${seed.musicalParams.bpm} BPM</span>
            <span>${esc(seed.musicalParams.rootNote)} ${esc(seed.musicalParams.scale)}</span>
            <a href="${esc(playHref)}${esc(buildShareHash(seed))}">${label} →</a>
          </div>
        </article>`;
}

function page(lang) {
  const seeds = loadSeeds(lang);
  const es = lang === "es";
  const origin = "https://vibedom.dev";
  const path = es ? `${origin}/sound-tests/` : `${origin}/en/sound-tests/`;
  const alt = es ? `${origin}/en/sound-tests/` : `${origin}/sound-tests/`;

  const title = es
    ? "Sound tests: a qué suenan 10 webs famosas · vibedom"
    : "Sound tests: what 10 famous websites sound like · vibedom";
  const desc = es
    ? "Diez webs conocidas convertidas en música generativa: Stripe, Apple, Spotify, Wikipedia… Escucha su banda sonora y abre la semilla en el playground."
    : "Ten well-known websites turned into generative music: Stripe, Apple, Spotify, Wikipedia… Listen to their soundtrack and open the seed in the playground.";
  const h1 = es ? "A qué suena la web que consumes" : "What the web you use sounds like";
  const intro = es
    ? "Ninguna IA gastó tu escaneo en esta página: cada banda sonora nació de un análisis real y quedó guardada como Semilla Sonora. Pulsa Escuchar — el audio se sintetiza en tu navegador — o abre cualquiera en el playground para mover sus controles. La última suena mejor de lo que nadie espera."
    : "No AI quota is spent on this page: every soundtrack came from a real analysis and is stored as a Sound Seed. Press Play — audio is synthesised in your browser — or open any of them in the playground to move its controls. The last one sounds better than anyone expects.";
  const cta = es ? "Escanea la tuya" : "Scan yours";
  const ctaHref = es ? "/" : "/en/";
  const ctaText = es
    ? "Tu web también tiene un sonido. Pega su URL y escúchalo en 10 segundos, sin registro."
    : "Your site has a sound too. Paste its URL and hear it in 10 seconds, no sign-up.";
  const footerTagline = es
    ? "Atmósferas sonoras procedurales para la web."
    : "Procedural soundscapes for the web.";
  const nav = es
    ? `<a href="../">Inicio</a>
          <a href="../playground/">Playground</a>
          <a href="../en/sound-tests/" hreflang="en" lang="en">English</a>
          <a href="https://github.com/germantes/vibedom" target="_blank" rel="noreferrer noopener">GitHub</a>`
    : `<a href="../../">Home</a>
          <a href="../../playground/en/">Playground</a>
          <a href="../../sound-tests/" hreflang="es" lang="es">Español</a>
          <a href="https://github.com/germantes/vibedom" target="_blank" rel="noreferrer noopener">GitHub</a>`;

  const ogImage = es ? `${origin}/assets/og-es.png` : `${origin}/assets/og-en.png`;
  const ogLocale = es ? "es_ES" : "en_US";

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0a0a0c" />
    <meta name="color-scheme" content="dark" />
    <meta name="vibedom-api" content="https://vibedom.onrender.com" />
    <link rel="icon" href="${es ? ".." : "../.."}${"/favicon.svg"}" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />

    <link rel="canonical" href="${path}" />
    <link rel="alternate" hreflang="es" href="${origin}/sound-tests/" />
    <link rel="alternate" hreflang="en" href="${origin}/en/sound-tests/" />
    <link rel="alternate" hreflang="x-default" href="${origin}/sound-tests/" />

    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="vibedom" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${path}" />
    <meta property="og:locale" content="${ogLocale}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${ogImage}" />

    <link rel="stylesheet" href="${es ? ".." : "../.."}/src/landing/landing.css" />
    <link rel="stylesheet" href="${es ? ".." : "../.."}/sound-tests/page.css" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "vibedom · Sound tests",
        "url": "${path}",
        "description": ${JSON.stringify(desc)},
        "applicationCategory": "MultimediaApplication",
        "operatingSystem": "Any",
        "browserRequirements": "Requires JavaScript and the Web Audio API",
        "inLanguage": "${lang}",
        "isAccessibleForFree": true
      }
    </script>
  </head>
  <body>
    <main id="main">
      <section class="section wrap st-intro">
        <p class="eyebrow">${es ? "Sound tests" : "Sound tests"}</p>
        <h1>${esc(h1)}</h1>
        <p class="lead">${esc(intro)}</p>
      </section>

      <section class="section wrap" id="tests">
        <div class="st-grid">
${seeds.map((entry) => stCard(entry, lang)).join("\n")}
        </div>
      </section>

      <section class="section wrap">
        <div class="cta-card">
          <div>
            <p class="eyebrow">${esc(cta)}</p>
            <h2>${es ? "La próxima puede ser la tuya." : "Yours could be next."}</h2>
            <p>${esc(ctaText)}</p>
          </div>
          <a class="btn btn-primary" href="${ctaHref}">${esc(cta)}</a>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="wrap footer-inner">
        <a class="footer-brand" href="${es ? ".." : "../.."}">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          vibedom
        </a>
        <p>${esc(footerTagline)}</p>
        <div class="footer-links">
          ${nav}
        </div>
      </div>
    </footer>

    <script type="module" src="${es ? ".." : "../.."}/sound-tests/page.js"></script>
  </body>
</html>
`;
}

mkdirSync(join(ROOT, "sound-tests"), { recursive: true });
mkdirSync(join(ROOT, "en", "sound-tests"), { recursive: true });
writeFileSync(join(ROOT, "sound-tests", "index.html"), page("es"));
writeFileSync(join(ROOT, "en", "sound-tests", "index.html"), page("en"));
console.log(`sound-tests ES/EN regenerados (${TODAY})`);
