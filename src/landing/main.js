import { attachReactivity } from "../engine/reactivity.js";
import { configureContext, createSoundscape } from "../engine/soundscape.js";
import { analysisCopy, applyI18n, t } from "../i18n.js";
import { API_URL, CAN_SCAN, STATIC_HOST, warmApi } from "../api.js";
import { createAnalysis } from "../demo/analysis.js";
import { createVisualizer } from "../demo/visualizer.js";

applyI18n();

const TONE_URL = "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm";
const PRESET_IDS = ["cyberpunk", "editorial", "indie-pastel"];
const BRAND_ACCENT = "#d8ff4f";
const BRAND_TEXT = "#f4f1e8";

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

function luminance(hex) {
  const value = String(hex).replace("#", "");
  const full =
    value.length === 3 || value.length === 4
      ? value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
      : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
  const accent = seed.uiTheme?.accentColor;
  if (!/^#[0-9a-f]{3,8}$/i.test(accent ?? "")) return BRAND_ACCENT;
  return luminance(accent) > 0.16 ? accent : BRAND_ACCENT;
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

function renderSeedMeta(seed, { showSource = false } = {}) {
  demoVibe.textContent = seed.metadata.detectedVibe;
  renderPalette(seed);

  const accent = seedAccent(seed);
  root.style.setProperty("--seed-accent", accent);
  root.style.setProperty("--seed-bg", seed.uiTheme.backgroundColor);
  visualizer.setColors({ accent, text: BRAND_TEXT });

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
  renderSeedMeta(activeSeed, { showSource });
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
