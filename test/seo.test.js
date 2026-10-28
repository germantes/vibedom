import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PAGES = [
  {
    file: "que-suena-mi-web/index.html",
    lang: "es",
    canonical: "https://vibedom.dev/que-suena-mi-web/",
    h1: "¿A qué suena mi web?",
    title: /¿A qué suena mi web\?/i,
    other: "https://vibedom.dev/en/what-does-my-website-sound-like/",
  },
  {
    file: "en/what-does-my-website-sound-like/index.html",
    lang: "en",
    canonical: "https://vibedom.dev/en/what-does-my-website-sound-like/",
    h1: "What does my website sound like?",
    title: /what does my website sound like\?/i,
    other: "https://vibedom.dev/que-suena-mi-web/",
  },
];

function read(file) {
  return readFileSync(join(ROOT, file), "utf8");
}

function jsonLd(html) {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "la página debe incluir JSON-LD");
  return JSON.parse(match[1]);
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comprueba que cada href/src relativo del HTML apunta a un archivo real. */
function assertLocalLinksExist(html, pageFile) {
  const pageDir = dirname(join(ROOT, pageFile));
  const broken = [];
  for (const [, raw] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(raw)) continue;
    const path = raw.split(/[?#]/)[0];
    if (!path) continue;
    let target = normalize(join(pageDir, path));
    if (path.endsWith("/") || (existsSync(target) && extname(target) === "")) {
      target = join(target, "index.html");
    }
    if (!target.startsWith(ROOT)) {
      broken.push(`${raw} (fuera del proyecto)`);
      continue;
    }
    if (!existsSync(target)) broken.push(raw);
  }
  assert.deepEqual(broken, [], `enlaces rotos en ${pageFile}`);
}

for (const page of PAGES) {
  test(`página SEO ${page.lang}: metadatos, canonical, hreflang y datos estructurados`, () => {
    const html = read(page.file);

    assert.match(html, new RegExp(`<html lang="${page.lang}">`));
    assert.match(html, page.title);
    assert.match(html, new RegExp(`<h1>${page.h1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${page.canonical}"`));
    assert.match(html, new RegExp(`hreflang="${page.lang}" href="${page.canonical}"`));
    assert.match(html, new RegExp(`hreflang="${page.lang === "es" ? "en" : "es"}" href="${page.other}"`));
    assert.match(html, new RegExp(`hreflang="x-default" href="${PAGES[0].canonical}"`));
    assert.match(html, /property="og:url"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);

    const data = jsonLd(html);
    const types = data["@graph"].map((node) => node["@type"]);
    assert.deepEqual(types, ["WebApplication", "BreadcrumbList", "FAQPage"]);

    const faq = data["@graph"].find((node) => node["@type"] === "FAQPage");
    assert.ok(faq.mainEntity.length >= 8, "la FAQ debe cubrir al menos 8 preguntas");

    const text = visibleText(html);
    for (const question of faq.mainEntity) {
      assert.ok(text.includes(question.name), `falta la pregunta visible: ${question.name}`);
      const answer = question.acceptedAnswer.text.replace(/\s+/g, " ");
      assert.ok(
        text.includes(answer.slice(0, 80)),
        `la respuesta visible no coincide con el JSON-LD: ${question.name}`,
      );
    }
  });

  test(`página SEO ${page.lang}: sin enlaces rotos y sin IDs duplicados`, () => {
    const html = read(page.file);
    assertLocalLinksExist(html, page.file);

    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicates)], [], `IDs duplicados en ${page.file}`);
  });
}

test("las landings conservan la verificación de Search Console", () => {
  for (const file of ["index.html", "en/index.html"]) {
    const html = read(file);
    assert.match(
      html,
      /<meta name="google-site-verification" content="google7f928a8ec81cb8b1" \/>/,
      `falta la etiqueta de verificación en ${file}`,
    );
  }
});

test("el sitemap incluye las dos páginas SEO con alternates recíprocos", () => {
  const xml = read("sitemap.xml");
  assert.match(xml, /<loc>https:\/\/vibedom\.dev\/que-suena-mi-web\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/vibedom\.dev\/en\/what-does-my-website-sound-like\/<\/loc>/);
  assert.match(
    xml,
    /hreflang="en" href="https:\/\/vibedom\.dev\/en\/what-does-my-website-sound-like\/"/,
  );
  assert.match(xml, /hreflang="es" href="https:\/\/vibedom\.dev\/que-suena-mi-web\/"/);
  assert.equal((xml.match(/<url>/g) ?? []).length, 6);
});
