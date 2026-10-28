import { attachReactivity } from "../engine/reactivity.js";
import { configureContext, createSoundscape } from "../engine/soundscape.js";
import { normalizeSeed } from "../engine/seed.js";
import { analysisCopy, applyI18n, getLang, presetCopy, rateLimitCopy, t } from "../i18n.js";
import { API_URL, CAN_SCAN, STATIC_HOST, warmApi } from "../api.js";
import { createAnalysis } from "./analysis.js";
import { createControls, formatHz } from "./controls.js";
import { createVisualizer } from "./visualizer.js";
import { accentFor, normalizeHex, onColorFor, relativeLuminance, textFor } from "../landing/theme.js";
import { buildShareHash, buildShareLink, buildWidgetSnippet, readShareHash } from "../embed.js";

applyI18n();

const TONE_URL = "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm";
// Origen con backend para la vista previa de enlaces compartidos. En un host
// estático sin API externa el enlace cae al `#seed` local.
const SHARE_ORIGIN = CAN_SCAN ? API_URL.origin : null;

const backendMissingMessage = () =>
  t(CAN_SCAN ? "status.backendMissing" : "status.backendMissingStatic");

if (STATIC_HOST && !CAN_SCAN) {
  const hint = document.querySelector(".scan-hint");
  if (hint) hint.textContent = t("status.staticHint");
} else if (STATIC_HOST) {
  const hint = document.querySelector(".scan-hint");
  if (hint) hint.textContent = t("status.remoteHint");
  warmApi();
}

const PRESET_IDS = ["cyberpunk", "editorial", "indie-pastel"];
const FONT_STACKS = {
  serif: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  "sans-serif": "system-ui, 'Segoe UI', Roboto, sans-serif",
  monospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  display: "'Trebuchet MS', 'Avenir Next Rounded', 'Comic Neue', system-ui, sans-serif",
};

const $ = (id) => document.getElementById(id);
const toggle = $("toggle");
const toggleLabel = $("toggle-label");
const status = $("status");
const presetButtons = [...document.querySelectorAll(".preset")];
const scanForm = $("scan-form");
const scanBtn = $("scan-btn");
const urlInput = $("url-input");
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
  status.textContent = text;
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

// ---- Tema ------------------------------------------------------------------

const visualizer = createVisualizer({
  spectrumCanvas: $("spectrum"),
  scopeCanvas: $("scope"),
  getEngine: () => engine,
});

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

function applyTheme(seed) {
  const { uiTheme } = seed;
  const bg = normalizeHex(uiTheme.backgroundColor) ?? "#111111";
  const text = textFor(bg, uiTheme.textColor) ?? "#f4f1e8";
  const accent = accentFor(uiTheme.accentColor, bg) ?? "#d8ff4f";

  root.style.setProperty("--bg", bg);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--on-accent", onColorFor(accent));
  root.style.setProperty("--text", text);
  root.style.setProperty("--font", FONT_STACKS[uiTheme.fontFamily] ?? FONT_STACKS["sans-serif"]);
  root.style.colorScheme = relativeLuminance(bg) < 0.4 ? "dark" : "light";
  $("meta-theme").setAttribute("content", bg);
  visualizer.setColors({ accent, text });
  renderPalette(seed);
}

// ---- Render de la semilla --------------------------------------------------

/** Copia visible: los presets se traducen; los escaneos ya llegan en su idioma. */
function seedCopy(seed) {
  const preset = presetCopy(activePreset);
  return {
    vibe: preset?.detectedVibe ?? seed.metadata.detectedVibe,
    explanation: preset?.explanation ?? seed.metadata.explanation,
  };
}

function renderParams(seed) {
  const { musicalParams: m, synthConfig: s, uiTheme } = seed;
  const WAVES = {
    sine: t("wave.sine"),
    triangle: t("wave.triangle"),
    sawtooth: t("wave.sawtooth"),
    square: t("wave.square"),
  };
  const SCALES = {
    major: t("scale.major"),
    minor: t("scale.minor"),
    dorian: t("scale.dorian"),
    phrygian: t("scale.phrygian"),
    lydian: t("scale.lydian"),
    pentatonic: t("scale.pentatonic"),
  };
  const SCROLL = {
    filterFreq: t("scroll.filterFreq"),
    reverbWet: t("scroll.reverbWet"),
    delayWet: t("scroll.delayWet"),
    arpDensity: t("scroll.arpDensity"),
  };
  const params = {
    [t("param.mode")]: relativeLuminance(uiTheme.backgroundColor) < 0.4 ? t("param.mode.dark") : t("param.mode.light"),
    [t("param.key")]: `${m.rootNote} ${SCALES[m.scale] ?? m.scale}`,
    [t("param.tempo")]: `${Math.round(m.bpm)} BPM`,
    [t("param.type")]: uiTheme.fontFamily,
    [t("param.padWave")]: WAVES[s.pad.waveform] ?? s.pad.waveform,
    [t("param.brightness")]: formatHz(s.pad.filterFreq),
    [t("param.arp")]: s.arp.enabled
      ? `${WAVES[s.arp.waveform] ?? s.arp.waveform} · ${Math.round(s.arp.density * 100)}%`
      : t("value.off"),
    [t("param.reverb")]: `${s.effects.reverbDecay.toFixed(1)} s · ${Math.round(s.effects.reverbWet * 100)}%`,
    [t("param.scroll")]: `${SCROLL[s.interactivity.scrollTarget] ?? s.interactivity.scrollTarget} ×${s.interactivity.scrollMultiplier}`,
  };

  $("params").replaceChildren(
    ...Object.entries(params).flatMap(([key, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = key;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

function renderSeed(seed, { showSource = true } = {}) {
  const copy = seedCopy(seed);
  $("vibe").textContent = copy.vibe;
  $("explanation").textContent = copy.explanation;
  $("json").textContent = JSON.stringify(seed, null, 2);
  renderSnippet(seed);
  syncShareUrl(seed);
  const share = $("share-seed");
  if (share) share.disabled = false;
  document.title = `vibedom · ${copy.vibe}`;

  const source = $("source-url");
  const sourceLine = source.closest(".source");
  if (showSource && /^https?:\/\//i.test(seed.metadata.url ?? "")) {
    const local = seed.metadata.source === "local";
    source.href = seed.metadata.url;
    source.textContent = `${seed.metadata.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}${
      local ? ` · ${t("source.local")}` : ""
    }`;
    source.title = local ? t("source.localTitle") : "";
    sourceLine.hidden = false;
  } else {
    sourceLine.hidden = true;
    source.removeAttribute("title");
  }

  renderParams(seed);
  controls.render(seed, { playing: Boolean(engine?.isPlaying) });
  renderToggle();
}

/** Actualiza solo lo que cambia con los sliders (sin resetear los propios sliders). */
function updateSeedView() {
  if (!activeSeed) return;
  $("json").textContent = JSON.stringify(activeSeed, null, 2);
  renderSnippet(activeSeed);
  syncShareUrl(activeSeed);
  renderParams(activeSeed);
}

/** El snippet apunta al dominio público; en local, al servidor de desarrollo. */
const WIDGET_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function renderSnippet(seed) {
  const el = $("embed");
  if (!el) return;
  const base = WIDGET_LOCAL ? location.origin : "https://vibedom.dev";
  el.textContent = buildWidgetSnippet(seed, { base });
}

/** Refleja la semilla activa en la barra de direcciones para poder compartirla. */
function syncShareUrl(seed) {
  if (!seed) return;
  try {
    const url = new URL(location.href);
    url.hash = buildShareHash(seed);
    history.replaceState(null, "", url);
  } catch {
    // Historial bloqueado (iframe sandbox): el botón de compartir sigue funcionando.
  }
}

// ---- Motor de audio --------------------------------------------------------

async function loadTone() {
  if (Tone) return Tone;
  setStatus(t("playground.status.loadingTone"));
  Tone = await import(TONE_URL);
  // El contexto se crea aquí, dentro del gesto del usuario, para que el
  // AudioContext que se desbloquee sea el mismo que usará el motor.
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
  controls.setPlaying(false);
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
    setStatus(t("playground.status.audioBlocked"));
    await teardown();
    return false;
  }

  controls.setPlaying(true);
  window.__vibedom = engine;
  const local = activeSeed.metadata?.source === "local";
  setStatus(
    t(local ? "playground.status.playingLocal" : "playground.status.playing", { vibe: seedCopy(activeSeed).vibe }),
  );
  renderToggle();
  return true;
}

async function restartAudio() {
  await teardown();
  return play();
}

function renderToggle() {
  const on = Boolean(engine?.isPlaying);
  toggle.setAttribute("aria-pressed", String(on));
  toggleLabel.textContent = on ? t("playground.pause") : t("playground.play");
  toggle.disabled = busy || !activeSeed;
  scanBtn.disabled = busy;
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  renderToggle();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setStatus(t("playground.status.audioError", { message: err.message }));
    await teardown().catch(() => {});
  } finally {
    busy = false;
    renderToggle();
  }
}

/** Carga una semilla (preset o escaneo) y, si toca, (re)arranca el audio. */
async function loadSeed(seed, { autoplay = false, presetId = null } = {}) {
  const wasPlaying = Boolean(engine?.isPlaying);
  activeSeed = structuredClone(seed);
  activePreset = presetId;
  presetButtons.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.preset === presetId)));
  applyTheme(activeSeed);
  renderSeed(activeSeed, { showSource: !presetId });

  if (wasPlaying || autoplay) {
    const ok = await restartAudio();
    if (!ok && autoplay) setStatus(t("playground.status.analysisReady"));
  } else {
    setStatus(t("playground.status.ready"));
  }
  renderToggle();
}

function selectPreset(id) {
  return loadSeed(presets[id], { presetId: id });
}

// ---- Controles manuales ----------------------------------------------------

const controls = createControls({
  root: $("controls"),
  copy: {
    arpOff: t("playground.arpOff"),
    arpOffAria: t("playground.arpOffAria"),
  },
  onChange: ({ key, value }) => {
    if (!activeSeed) return;
    controls.write(activeSeed, key, value);

    if (engine?.isPlaying) {
      if (key === "bpm") engine.setBpm(activeSeed.musicalParams.bpm);
      else if (key === "brightness") engine.setFilterFreq(activeSeed.synthConfig.pad.filterFreq);
      else if (key === "spatiality") engine.setReverbWet(activeSeed.synthConfig.effects.reverbWet);
      else if (key === "density") engine.setArpDensity(activeSeed.synthConfig.arp.density);
    }

    updateSeedView();
  },
  onRegenerate: () => {
    if (!engine?.isPlaying) {
      setStatus(t("playground.status.regenerate"));
      return;
    }
    const result = engine.regenerate();
    if (result) setStatus(t("playground.status.variation", { degree: result.degree + 1 }));
  },
});

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
    setStatus(t("playground.status.invalidUrl"));
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
  presetButtons.forEach((button) => (button.disabled = true));
  scanForm.setAttribute("aria-busy", "true");
  renderToggle();
  analysis.start();

  // Precalentamos el AudioContext dentro del gesto de usuario. El fetch tarda
  // varios segundos y, sin esto, algunos navegadores bloquearían el autoplay.
  const audioReady = loadTone()
    .then(() => Tone.start())
    .catch(() => {});

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target, lang: getLang() }),
      signal: scanController.signal,
    });

    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    const data = isJson ? await res.json() : {};
    if (!res.ok) {
      if (data.code === "RATE_LIMITED") {
        throw Object.assign(new Error(rateLimitCopy(data.retryAfter, "playground.status")), { friendly: true });
      }
      const message =
        data.error ??
        (res.status === 404 || res.status === 405
          ? backendMissingMessage()
          : `Error ${res.status}`);
      throw new Error(message);
    }

    analysis.finish();
    await audioReady;

    try {
      await loadSeed(data, { autoplay: true });
    } catch (audioError) {
      console.error(audioError);
      setStatus(t("playground.status.audioError", { message: audioError.message }));
    }

    analysis.hideSoon();
  } catch (err) {
    if (err.name === "AbortError") {
      analysis.cancel();
      setStatus(t("playground.status.cancelled"));
    } else {
      console.error(err);
      const message = err instanceof TypeError ? t("status.backendUnreachable") : err.message;
      analysis.fail(message);
      setStatus(err.friendly ? message : t("playground.status.scanError", { message }));
    }
  } finally {
    busy = false;
    scanBtn.disabled = false;
    presetButtons.forEach((button) => (button.disabled = false));
    scanForm.removeAttribute("aria-busy");
    scanController = null;
    renderToggle();
  }
});

// ---- Interacción -----------------------------------------------------------

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("No se pudo copiar");
}

/** Cambia la etiqueta de un botón durante 2 s y la restaura. */
function flashLabel(button, key, restoreKey) {
  clearTimeout(Number(button.dataset.labelTimer) || 0);
  button.textContent = t(key);
  const timer = setTimeout(() => {
    button.textContent = t(restoreKey);
    delete button.dataset.labelTimer;
  }, 2000);
  button.dataset.labelTimer = String(timer);
}

const copyEmbed = $("copy-embed");

copyEmbed?.addEventListener("click", async () => {
  const code = $("embed")?.textContent ?? "";
  if (!code) return;
  try {
    await copyText(code);
    flashLabel(copyEmbed, "playground.embed.copied", "playground.embed.copy");
  } catch {
    flashLabel(copyEmbed, "playground.embed.copyError", "playground.embed.copy");
  }
});

const shareBtn = $("share-seed");

shareBtn?.addEventListener("click", async () => {
  if (!activeSeed) return;
  const url = new URL(location.href);
  url.hash = buildShareHash(activeSeed);

  const link = buildShareLink(activeSeed, { origin: SHARE_ORIGIN, lang: getLang() });

  try {
    await copyText(link || url.href);
    try {
      history.replaceState(null, "", url);
    } catch {
      // La copia ya se hizo; el historial puede estar bloqueado.
    }
    flashLabel(shareBtn, "playground.share.copied", "playground.share.copy");
  } catch {
    flashLabel(shareBtn, "playground.share.error", "playground.share.copy");
  }
});

toggle.addEventListener("click", () =>
  withBusy(async () => {
    if (engine?.isPlaying) {
      await teardown();
      setStatus(t("playground.status.paused"));
    } else {
      await play();
    }
  }),
);

presetButtons.forEach((button) =>
  button.addEventListener("click", () => withBusy(() => selectPreset(button.dataset.preset))),
);

// ---- Arranque --------------------------------------------------------------

try {
  const entries = await Promise.all(
    PRESET_IDS.map(async (id) => {
      const res = await fetch(new URL(`../../presets/${id}.json`, import.meta.url));
      if (!res.ok) throw new Error(`No se pudo cargar el preset ${id}`);
      return [id, await res.json()];
    }),
  );
  presets = Object.fromEntries(entries);

  // Enlace compartido: #seed=<base64url>. Se valida como cualquier semilla
  // externa antes de tocar el motor o el DOM.
  let sharedSeed = null;
  let sharedInvalid = false;
  const hasSharedToken = /(?:^#|&)seed=/.test(location.hash);
  if (hasSharedToken) {
    try {
      const raw = readShareHash(location.hash);
      if (raw) {
        sharedSeed = normalizeSeed(raw);
        if (raw.metadata?.source === "local") sharedSeed.metadata.source = "local";
      } else {
        sharedInvalid = true;
      }
    } catch (err) {
      console.warn("[vibedom] enlace compartido inválido:", err.message);
      sharedInvalid = true;
    }
  }

  if (sharedSeed) {
    await loadSeed(sharedSeed);
    setStatus(t("playground.status.shared"));
  } else {
    await selectPreset(PRESET_IDS[0]);
    if (sharedInvalid) setStatus(t("playground.status.sharedInvalid"));
  }
} catch (err) {
  console.error(err);
  setStatus(t("playground.status.presetsError"));
}
