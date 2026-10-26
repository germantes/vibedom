import { attachReactivity } from "../engine/reactivity.js";
import { configureContext, createSoundscape } from "../engine/soundscape.js";
import { analysisCopy, applyI18n, t } from "../i18n.js";
import { API_URL, CAN_SCAN, STATIC_HOST, warmApi } from "../api.js";
import { createAnalysis } from "../demo/analysis.js";
import { createVisualizer } from "../demo/visualizer.js";
import {
  accentFor,
  mixHex,
  normalizeHex,
  onColorFor,
  relativeLuminance,
  textFor,
  withAlpha,
} from "./theme.js";

applyI18n();

const TONE_URL = "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm";
const PRESET_IDS = ["cyberpunk", "editorial", "indie-pastel"];
const BRAND_ACCENT = "#d8ff4f";
const BRAND_TEXT = "#f4f1e8";
const BRAND_BG = "#0a0a0c";
const metaTheme = document.querySelector('meta[name="theme-color"]');

if (STATIC_HOST && !CAN_SCAN) {
  const hint = document.querySelector(".hint");
  if (hint) hint.textContent = t("status.staticHint");
} else if (STATIC_HOST) {
  const hint = document.querySelector(".hint");
  if (hint) hint.textContent = t("status.remoteHint");
  warmApi();
}

const $ = (id) => document.getElementById(id);
const demoCard = $("demo-card");
const toggle = $("demo-toggle");
const toggleLabel = $("demo-toggle-label");
const demoStatus = $("demo-status");
const demoVibe = $("demo-vibe");
const scanForm = $("scan-form");
const scanBtn = $("scan-btn");
const urlInput = $("url-input");
const presetButtons = [...document.querySelectorAll(".preset")];
const root = document.documentElement;

let Tone = null;
let presets = {};
let activeSeed = null;
let activePreset = null;
let engine = null;
let detach = null;
let busy = false;
let scanController = null;

// ---- Utilidades ------------------------------------------------------------

function setStatus(text) {
  demoStatus.textContent = text;
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function seedAccent(seed) {
  const accent = normalizeHex(seed.uiTheme?.accentColor);
  if (!accent) return BRAND_ACCENT;
  return relativeLuminance(accent) > 0.16 ? accent : BRAND_ACCENT;
}

// ---- Tema de la página -----------------------------------------------------

const THEME_VARS = [
  "--bg",
  "--bg-soft",
  "--text",
  "--accent",
  "--accent-ink",
  "--on-accent",
  "--glow-1",
  "--glow-2",
  "--card-shadow",
];

/**
 * La página adopta la paleta del sitio escaneado. El color de texto se corrige
 * por contraste, así que un sitio claro pinta la landing en claro sin dejar
 * texto ilegible.
 */
function applyTheme(seed) {
  const bg = normalizeHex(seed.uiTheme?.backgroundColor);
  if (!bg) return resetTheme();

  const text = textFor(bg, seed.uiTheme?.textColor) ?? BRAND_TEXT;
  const accent = accentFor(seed.uiTheme?.accentColor, bg) ?? BRAND_ACCENT;
  const dark = relativeLuminance(bg) <= 0.4;

  root.style.setProperty("--bg", bg);
  root.style.setProperty("--bg-soft", mixHex(bg, text, 0.07));
  root.style.setProperty("--text", text);
  root.style.setProperty("--accent", accent);
  // El texto en acento también aparece sobre el tinte del badge (acento al 14%).
  root.style.setProperty("--accent-ink", accentFor(accent, mixHex(bg, accent, 0.14), 4.5) ?? accent);
  root.style.setProperty("--on-accent", onColorFor(accent));
  root.style.setProperty("--glow-1", withAlpha(accent, dark ? 0.2 : 0.14));
  root.style.setProperty("--glow-2", withAlpha(accent, dark ? 0.09 : 0.07));
  root.style.setProperty(
    "--card-shadow",
    dark ? "0 28px 70px rgba(0, 0, 0, 0.45)" : "0 24px 60px rgba(0, 0, 0, 0.16)",
  );
  root.style.colorScheme = dark ? "dark" : "light";
  root.classList.add("is-themed");
  metaTheme?.setAttribute("content", bg);

  return { bg, text, accent };
}

/** Vuelve a la paleta de marca (al elegir un preset o recargar). */
function resetTheme() {
  for (const name of THEME_VARS) root.style.removeProperty(name);
  root.style.removeProperty("color-scheme");
  root.classList.remove("is-themed");
  metaTheme?.setAttribute("content", BRAND_BG);
  return { bg: BRAND_BG, text: BRAND_TEXT, accent: BRAND_ACCENT };
}

// ---- Visualizador ----------------------------------------------------------

const visualizer = createVisualizer({
  spectrumCanvas: $("spectrum"),
  scopeCanvas: $("scope"),
  getEngine: () => engine,
});
visualizer.setColors({ accent: BRAND_ACCENT, text: BRAND_TEXT });

// ---- Render de la demo -----------------------------------------------------

function renderPalette(seed) {
  const colors = [
    [t("playground.palette.background"), seed.uiTheme.backgroundColor],
    [t("playground.palette.accent"), seed.uiTheme.accentColor],
    [t("playground.palette.text"), seed.uiTheme.textColor],
  ];
  $("palette").replaceChildren(
    ...colors.map(([label, color]) => {
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = color;
      swatch.title = `${label}: ${color}`;
      swatch.setAttribute("aria-label", `${label} ${color}`);
      return swatch;
    }),
  );
}

function renderSeedMeta(seed, { showSource = false, themed = false } = {}) {
  demoVibe.textContent = seed.metadata.detectedVibe;
  renderPalette(seed);

  const accent = seedAccent(seed);
  root.style.setProperty("--seed-accent", accent);
  root.style.setProperty("--seed-bg", seed.uiTheme.backgroundColor);
  root.style.setProperty("--on-seed-accent", onColorFor(accent));

  const theme = themed ? applyTheme(seed) : resetTheme();
  const cardBg = themed ? mixHex(theme.bg, theme.text, 0.07) : "#121216";
  root.style.setProperty("--seed-accent-ink", accentFor(accent, cardBg, 4.5) ?? accent);
  visualizer.setColors({ accent: themed ? theme.accent : accent, text: theme.text });

  const source = $("demo-source");
  const url = seed.metadata.url ?? "";
  if (showSource && /^https?:\/\//i.test(url)) {
    source.href = url;
    source.textContent = `${t("landing.demo.source")}: ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    source.hidden = false;
  } else {
    source.hidden = true;
    source.removeAttribute("href");
  }
}

function renderToggle() {
  const on = Boolean(engine?.isPlaying);
  toggle.setAttribute("aria-pressed", String(on));
  toggleLabel.textContent = on ? t("landing.demo.pause") : t("landing.demo.play");
  toggle.disabled = busy || !activeSeed;
  scanBtn.disabled = busy;
  presetButtons.forEach((button) => {
    button.disabled = busy;
    button.setAttribute("aria-checked", String(button.dataset.preset === activePreset));
  });
  demoCard.classList.toggle("is-playing", on);
}

// ---- Motor de audio --------------------------------------------------------

async function loadTone() {
  if (Tone) return Tone;
  setStatus(t("status.loadingTone"));
  Tone = await import(TONE_URL);
  configureContext(Tone);
  return Tone;
}

async function teardown() {
  detach?.();
  detach = null;
  if (engine) {
    const old = engine;
    engine = null;
    try {
      await old.stop();
    } finally {
      old.dispose();
    }
  }
  renderToggle();
}

async function play() {
  if (!activeSeed) return false;
  await loadTone();
  await Tone.start();
  engine = await createSoundscape(Tone, activeSeed);
  detach = attachReactivity(engine);
  await engine.start();

  if (Tone.getContext().state !== "running") {
    setStatus(t("status.audioBlocked"));
    await teardown();
    return false;
  }

  window.__vibedom = engine;
  setStatus(t("status.playing", { vibe: activeSeed.metadata.detectedVibe }));
  renderToggle();
  return true;
}

async function restartAudio() {
  await teardown();
  return play();
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  renderToggle();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setStatus(t("status.audioError", { message: err.message }));
    await teardown().catch(() => {});
  } finally {
    busy = false;
    renderToggle();
  }
}

async function loadSeed(rawSeed, { presetId = null, autoplay = false, showSource = false } = {}) {
  const wasPlaying = Boolean(engine?.isPlaying);
  activeSeed = structuredClone(rawSeed);
  activePreset = presetId;
  renderSeedMeta(activeSeed, { showSource, themed: presetId === null });
  renderToggle();

  if (wasPlaying || autoplay) {
    const ok = await restartAudio();
    if (!ok && autoplay) setStatus(t("status.analysisReady"));
  } else {
    setStatus(t("status.ready"));
  }
  renderToggle();
}

function selectPreset(id) {
  if (!presets[id]) return Promise.resolve();
  return loadSeed(presets[id], { presetId: id, autoplay: true });
}

// ---- Análisis de URL -------------------------------------------------------

const analysis = createAnalysis({
  root: $("analysis"),
  stepEl: $("analysis-step"),
  subEl: $("analysis-sub"),
  listEl: $("analysis-steps"),
  progressEl: $("analysis-progress"),
  cancelBtn: $("analysis-cancel"),
  retryBtn: $("analysis-retry"),
  copy: analysisCopy(),
});

$("analysis-cancel").addEventListener("click", () => scanController?.abort());
$("analysis-retry").addEventListener("click", () => {
  analysis.hide();
  scanForm.requestSubmit();
});

scanForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const target = normalizeUrl(urlInput.value);
  if (!target) {
    setStatus(t("status.invalidUrl"));
    urlInput.focus();
    return;
  }
  urlInput.value = target;

  if (!CAN_SCAN) {
    const message = t("status.backendMissingStatic");
    analysis.fail(message);
    setStatus(message);
    return;
  }

  scanController = new AbortController();
  busy = true;
  scanBtn.disabled = true;
  scanForm.setAttribute("aria-busy", "true");
  renderToggle();
  analysis.start();

  // Precalentamos el AudioContext dentro del gesto de usuario: el fetch tarda
  // varios segundos y, sin esto, algunos navegadores bloquearían el autoplay.
  const audioReady = loadTone()
    .then(() => Tone.start())
    .catch(() => {});

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
      signal: scanController.signal,
    });

    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    const data = isJson ? await res.json() : {};
    if (!res.ok) {
      const fallback =
        res.status === 404 || res.status === 405
          ? t(CAN_SCAN ? "status.backendMissing" : "status.backendMissingStatic")
          : `Error ${res.status}`;
      throw new Error(data.error ?? fallback);
    }

    analysis.finish();
    await audioReady;
    await loadSeed(data, { autoplay: true, showSource: true });
    analysis.hideSoon();
  } catch (err) {
    if (err.name === "AbortError") {
      analysis.cancel();
      setStatus(t("status.cancelled"));
    } else {
      console.error(err);
      const message = err instanceof TypeError ? t("status.backendUnreachable") : err.message;
      analysis.fail(message);
      setStatus(message);
    }
  } finally {
    busy = false;
    scanBtn.disabled = false;
    scanForm.removeAttribute("aria-busy");
    scanController = null;
    renderToggle();
  }
});

// ---- Interacción -----------------------------------------------------------

toggle.addEventListener("click", () =>
  withBusy(async () => {
    if (engine?.isPlaying) {
      await teardown();
      setStatus(t("status.paused"));
    } else {
      await play();
    }
  }),
);

presetButtons.forEach((button) =>
  button.addEventListener("click", () => withBusy(() => selectPreset(button.dataset.preset))),
);

// ---- Arranque --------------------------------------------------------------

setStatus(t("status.loadingPresets"));
try {
  const entries = await Promise.all(
    PRESET_IDS.map(async (id) => {
      const res = await fetch(new URL(`../../presets/${id}.json`, import.meta.url));
      if (!res.ok) throw new Error(`No se pudo cargar el preset ${id}`);
      return [id, await res.json()];
    }),
  );
  presets = Object.fromEntries(entries);
  await loadSeed(presets[PRESET_IDS[0]], { presetId: PRESET_IDS[0] });
} catch (err) {
  console.error(err);
  setStatus(t("status.presetsError"));
}
