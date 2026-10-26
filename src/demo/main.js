import { createSoundscape } from "../engine/soundscape.js";
import { attachReactivity } from "../engine/reactivity.js";

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

let Tone = null;
let presets = {};
let activeSeed = null; // semilla activa (preset o resultado de escaneo)
let engine = null;
let detach = null;
let busy = false;

function setStatus(text) {
  status.textContent = text;
}

function applyTheme({ uiTheme }) {
  const root = document.documentElement.style;
  root.setProperty("--bg", uiTheme.backgroundColor);
  root.setProperty("--accent", uiTheme.accentColor);
  root.setProperty("--text", uiTheme.textColor);
  root.setProperty("--font", FONT_STACKS[uiTheme.fontFamily]);
}

function renderSeed(seed) {
  const { musicalParams: m, synthConfig: s } = seed;
  $("vibe").textContent = seed.metadata.detectedVibe;
  $("explanation").textContent = seed.metadata.explanation;
  $("json").textContent = JSON.stringify(seed, null, 2);
  const params = {
    Tonalidad: `${m.rootNote} ${m.scale}`,
    BPM: m.bpm,
    "Onda pad": s.pad.waveform,
    "Onda arpegio": s.arp.enabled ? s.arp.waveform : "off",
    Densidad: s.arp.density,
    Reverb: `${s.effects.reverbDecay}s · ${Math.round(s.effects.reverbWet * 100)}%`,
    Scroll: `${s.interactivity.scrollTarget} ×${s.interactivity.scrollMultiplier}`,
  };
  $("params").replaceChildren(
    ...Object.entries(params).flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

async function loadTone() {
  if (Tone) return Tone;
  setStatus("Descargando Tone.js…");
  Tone = await import(TONE_URL);
  return Tone;
}

async function teardown() {
  detach?.();
  detach = null;
  if (engine) {
    const old = engine;
    engine = null;
    await old.stop();
    old.dispose();
  }
}

async function play() {
  await loadTone();
  await Tone.start();
  setStatus("Preparando motor…");
  engine = await createSoundscape(Tone, activeSeed);
  detach = attachReactivity(engine);
  await engine.start();
  window.__vibedom = engine;
  setStatus(`Sonando: ${activeSeed.metadata.detectedVibe}`);
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

/** Carga una semilla (de preset o escaneo) y opcionalmente arranca. */
async function loadSeed(seed, { autoplay = false } = {}) {
  const wasPlaying = Boolean(engine?.isPlaying);
  activeSeed = seed;
  presetButtons.forEach((b) => b.setAttribute("aria-checked", "false"));
  applyTheme(seed);
  renderSeed(seed);
  if (wasPlaying || autoplay) {
    await withBusy(async () => {
      await teardown();
      await play();
    });
  } else {
    setStatus("Listo. Pulsa reproducir.");
    renderToggle();
  }
}

function selectPreset(id) {
  presetButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.preset === id)));
  return loadSeed(presets[id]);
}

// ---- Escaneo de URL --------------------------------------------------------

scanForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url || busy) return;
  withBusy(async () => {
    scanBtn.disabled = true;
    setStatus("Analizando la web…");
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    scanBtn.disabled = false;
    await loadSeed(data, { autoplay: true });
  });
});

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

presetButtons.forEach((b) => b.addEventListener("click", () => selectPreset(b.dataset.preset)));

// Osciloscopio
const canvas = $("scope");
const ctx = canvas.getContext("2d");
function draw() {
  requestAnimationFrame(draw);
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (!engine?.isPlaying) return;
  const values = engine.analyser.getValue();
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height / 2 - v * height * 1.2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}
requestAnimationFrame(draw);

// Arranque
const entries = await Promise.all(
  PRESET_IDS.map(async (id) => {
    const res = await fetch(new URL(`../../presets/${id}.json`, import.meta.url));
    if (!res.ok) throw new Error(`No se pudo cargar el preset ${id}`);
    return [id, await res.json()];
  }),
);
presets = Object.fromEntries(entries);
await selectPreset(PRESET_IDS[0]);
