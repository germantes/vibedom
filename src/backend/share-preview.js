// Página intermedia para compartir: los rastreadores sociales leen sus etiquetas
// Open Graph (título, descripción e imagen de la semilla) y las personas acaban
// en el playground con el `#seed` intacto. Sin JavaScript obligatorio: el
// `<meta refresh>` también redirige.

const COPY = {
  es: {
    lang: "es",
    title: (vibe, host) => (host ? `${host} suena a ${vibe} · vibedom` : `${vibe} · vibedom`),
    description: (details) =>
      `${details ? `${details}. ` : ""}Escucha la identidad sonora de esta web, generada en tu navegador sin samples ni registro.`,
    cta: "Abrir en el playground",
    redirecting: "Abriendo el playground…",
    invalidTitle: "Ese enlace no lleva una semilla válida · vibedom",
    invalidBody: "El enlace está incompleto o se ha cortado al copiarlo.",
    invalidCta: "Ir al playground",
  },
  en: {
    lang: "en",
    title: (vibe, host) => (host ? `${host} sounds like ${vibe} · vibedom` : `${vibe} · vibedom`),
    description: (details) =>
      `${details ? `${details}. ` : ""}Hear this site's sonic identity, generated in your browser with no samples and no sign-up.`,
    cta: "Open in the playground",
    redirecting: "Opening the playground…",
    invalidTitle: "That link doesn't carry a valid seed · vibedom",
    invalidBody: "The link is incomplete or was cut off when copied.",
    invalidCta: "Go to the playground",
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function safeHost(url) {
  try {
    return new URL(String(url)).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function describe(seed, lang) {
  const { bpm, rootNote, scale } = seed?.musicalParams ?? {};
  const waveform = seed?.synthConfig?.pad?.waveform;
  const bits = [
    bpm ? `${bpm} BPM` : null,
    rootNote && scale ? `${rootNote} ${scale}` : null,
    waveform && lang === "en" ? `${waveform} pad` : waveform ? `pad ${waveform}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

/**
 * HTML de `/s/<token>`.
 * @param {object} seed Semilla ya normalizada.
 * @param {{ origin: string, token: string, lang?: "es"|"en", site?: string }} options
 *   `origin` construye la URL de la imagen OG; `site` es el destino humano
 *   (por defecto el mismo origen). En producción `site` es vibedom.dev para
 *   que quien abra el enlace acabe en el sitio estático, no en Render.
 */
export function renderSharePage(seed, { origin, token, lang = "es", site }) {
  const copy = COPY[lang] ?? COPY.es;
  const base = String(origin).replace(/\/+$/, "");
  const siteBase = String(site || origin).replace(/\/+$/, "");
  const vibe = seed?.metadata?.detectedVibe || (lang === "en" ? "an unknown vibe" : "una atmósfera sonora");
  const host = safeHost(seed?.metadata?.url);
  const title = copy.title(vibe, host);
  const description = copy.description(describe(seed, lang));
  const image = `${base}/s/${token}.png`;
  const target = `${siteBase}${lang === "en" ? "/playground/en/" : "/playground/"}#seed=${token}`;
  const theme = seed?.uiTheme ?? {};

  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="${escapeHtml(theme.backgroundColor ?? "#0a0a0c")}" />
    <meta name="robots" content="noindex, follow" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(target.split("#")[0])}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="vibedom" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(`${base}/s/${token}`)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />

    <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" />
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: ${escapeHtml(theme.backgroundColor ?? "#0a0a0c")};
        color: ${escapeHtml(theme.textColor ?? "#f4f1e8")};
        font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      main { max-width: 34rem; padding: 2rem; text-align: center; }
      h1 { margin: 0 0 0.6rem; font-size: 1.5rem; letter-spacing: -0.02em; }
      p { margin: 0 0 1.4rem; opacity: 0.75; }
      a {
        display: inline-block;
        padding: 0.75rem 1.25rem;
        border-radius: 999px;
        background: ${escapeHtml(theme.accentColor ?? "#d8ff4f")};
        color: ${escapeHtml(theme.backgroundColor ?? "#0a0a0c")};
        font-weight: 650;
        text-decoration: none;
      }
    </style>
    <script>location.replace(${JSON.stringify(target)});</script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(vibe)}</h1>
      <p>${escapeHtml(copy.redirecting)}</p>
      <a href="${escapeHtml(target)}">${escapeHtml(copy.cta)}</a>
    </main>
  </body>
</html>
`;
}

/** Página mínima para tokens corruptos: 400, sin redirección automática. */
export function renderShareError(lang = "es") {
  const copy = COPY[lang] ?? COPY.es;
  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, follow" />
    <title>${escapeHtml(copy.invalidTitle)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0c; color: #f4f1e8; font: 1rem/1.5 system-ui, sans-serif; }
      main { max-width: 32rem; padding: 2rem; text-align: center; }
      a { color: #d8ff4f; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(copy.invalidTitle)}</h1>
      <p>${escapeHtml(copy.invalidBody)}</p>
      <p><a href="/playground/${lang === "en" ? "en/" : ""}">${escapeHtml(copy.invalidCta)}</a></p>
    </main>
  </body>
</html>
`;
}
