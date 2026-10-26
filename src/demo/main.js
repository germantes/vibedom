import { attachReactivity } from "../engine/reactivity.js";
import { configureContext, createSoundscape } from "../engine/soundscape.js";
import { createAnalysis } from "./analysis.js";
import { createControls, formatHz } from "./controls.js";
import { createVisualizer } from "./visualizer.js";

const TONE_URL = "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm";
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
let engine = null;
let detach = null;
let busy = false;
let scanController = null;

// ---- Utilidades ------------------------------------------------------------

function setStatus(text) {
  status.textContent = text;
}

function luminance(hex) {
  const value = hex.replace("#", "");
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

// ---- Tema ------------------------------------------------------------------

const visualizer = createVisualizer({
  spectrumCanvas: $("spectrum"),
  scopeCanvas: $("scope"),
  getEngine: () => engine,
});

function renderPalette(seed) {
  const colors = [
    ["Fondo", seed.uiTheme.backgroundColor],
    ["Acento", seed.uiTheme.accentColor],
    ["Texto", seed.uiTheme.textColor],
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
  root.style.setProperty("--bg", uiTheme.backgroundColor);
  root.style.setProperty("--accent", uiTheme.accentColor);
  root.style.setProperty("--on-accent", luminance(uiTheme.accentColor) < 0.179 ? "#ffffff" : "#111111");
  root.style.setProperty("--text", uiTheme.textColor);
  root.style.setProperty("--font", FONT_STACKS[uiTheme.fontFamily] ?? FONT_STACKS["sans-serif"]);
  root.style.colorScheme = luminance(uiTheme.backgroundColor) < 0.4 ? "dark" : "light";
  $("meta-theme").setAttribute("content", uiTheme.backgroundColor);
  visualizer.setColors({ accent: uiTheme.accentColor, text: uiTheme.textColor });
  renderPalette(seed);
}

// ---- Render de la semilla --------------------------------------------------

function renderParams(seed) {
  const { musicalParams: m, synthConfig: s, uiTheme } = seed;
  const WAVES = {
    sine: "seno",
    triangle: "triángulo",
    sawtooth: "sierra",
    square: "cuadrada",
  };
  const SCALES = {
    major: "mayor",
    minor: "menor",
    dorian: "dórico",
    phrygian: "frigio",
    lydian: "lidio",
    pentatonic: "pentatónica",
  };
  const SCROLL = {
    filterFreq: "brillo",
    reverbWet: "espacialidad",
    delayWet: "eco",
    arpDensity: "densidad",
  };
  const params = {
    Modo: luminance(uiTheme.backgroundColor) < 0.4 ? "oscuro" : "claro",
    Tonalidad: `${m.rootNote} ${SCALES[m.scale] ?? m.scale}`,
    Tempo: `${Math.round(m.bpm)} BPM`,
    Tipografía: uiTheme.fontFamily,
    "Onda pad": WAVES[s.pad.waveform] ?? s.pad.waveform,
    Brillo: formatHz(s.pad.filterFreq),
    Arpegio: s.arp.enabled ? `${WAVES[s.arp.waveform] ?? s.arp.waveform} · ${Math.round(s.arp.density * 100)}%` : "off",
    Reverb: `${s.effects.reverbDecay.toFixed(1)} s · ${Math.round(s.effects.reverbWet * 100)}%`,
    Scroll: `${SCROLL[s.interactivity.scrollTarget] ?? s.interactivity.scrollTarget} ×${s.interactivity.scrollMultiplier}`,
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
  $("vibe").textContent = seed.metadata.detectedVibe;
  $("explanation").textContent = seed.metadata.explanation;
  $("json").textContent = JSON.stringify(seed, null, 2);
  document.title = `vibedom · ${seed.metadata.detectedVibe}`;

  const source = $("source-url");
  const sourceLine = source.closest(".source");
  if (showSource && /^https?:\/\//i.test(seed.metadata.url ?? "")) {
    source.href = seed.metadata.url;
    source.textContent = seed.metadata.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    sourceLine.hidden = false;
  } else {
    sourceLine.hidden = true;
  }

  renderParams(seed);
  controls.render(seed, { playing: Boolean(engine?.isPlaying) });
  renderToggle();
}

/** Actualiza solo lo que cambia con los sliders (sin resetear los propios sliders). */
function updateSeedView() {
  if (!activeSeed) return;
  $("json").textContent = JSON.stringify(activeSeed, null, 2);
  renderParams(activeSeed);
}

// ---- Motor de audio --------------------------------------------------------

async function loadTone() {
  if (Tone) return Tone;
  setStatus("Descargando Tone.js…");
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
    setStatus("El navegador ha bloqueado el audio. Pulsa Reproducir para activarlo.");
    await teardown();
    return false;
  }

  controls.setPlaying(true);
  window.__vibedom = engine;
  setStatus(`Sonando: ${activeSeed.metadata.detectedVibe}`);
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
  toggleLabel.textContent = on ? "Pausar" : "Reproducir";
  toggle.disabled = busy || !activeSeed;
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  renderToggle();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
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
  presetButtons.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.preset === presetId)));
  applyTheme(activeSeed);
  renderSeed(activeSeed, { showSource: !presetId });

  if (wasPlaying || autoplay) {
    const ok = await restartAudio();
    if (!ok && autoplay) setStatus("Análisis listo. Pulsa Reproducir para escuchar tu web.");
  } else {
    setStatus("Listo. Pulsa Reproducir.");
  }
  renderToggle();
}

function selectPreset(id) {
  return loadSeed(presets[id], { presetId: id });
}

// ---- Controles manuales ----------------------------------------------------

const controls = createControls({
  root: $("controls"),
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
      setStatus("Pulsa Reproducir para escuchar la variación.");
      return;
    }
    const result = engine.regenerate();
    if (result) setStatus(`Nueva variación · grado ${result.degree + 1} de la escala.`);
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
    setStatus("Escribe una URL válida, por ejemplo https://stripe.com");
    urlInput.focus();
    return;
  }
  urlInput.value = target;

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
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
      signal: scanController.signal,
    });

    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    const data = isJson ? await res.json() : {};
    if (!res.ok) {
      const message =
        data.error ??
        (res.status === 404
          ? "El backend no está disponible. Arranca el servidor con `npm start`."
          : `Error ${res.status}`);
      throw new Error(message);
    }

    analysis.finish();
    await audioReady;

    try {
      await loadSeed(data, { autoplay: true });
    } catch (audioError) {
      console.error(audioError);
      setStatus(`Semilla lista, pero no se pudo iniciar el audio: ${audioError.message}`);
    }

    analysis.hideSoon();
  } catch (err) {
    if (err.name === "AbortError") {
      analysis.cancel();
      setStatus("Análisis cancelado.");
    } else {
      console.error(err);
      analysis.fail(err.message);
      setStatus(`No se pudo analizar: ${err.message}`);
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

toggle.addEventListener("click", () =>
  withBusy(async () => {
    if (engine?.isPlaying) {
      await teardown();
      setStatus("En pausa.");
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
  await selectPreset(PRESET_IDS[0]);
} catch (err) {
  console.error(err);
  setStatus("No se pudieron cargar los presets. Recarga la página.");
}
