import { createSoundscape } from "../engine/soundscape.js";
import { attachReactivity } from "../engine/reactivity.js";

// Tone.js se descarga solo al primer clic en "Reproducir" (mismo patrón que tendrá el widget).
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

let Tone = null;
let presets = {};
let currentId = null;
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
  await Tone.start(); // dentro del gesto del usuario
  setStatus("Generando reverb…");
  engine = await createSoundscape(Tone, presets[currentId]);
  detach = attachReactivity(engine);
  await engine.start();
  window.__vibedom = engine; // inspección desde la consola
  setStatus(`Sonando: ${presets[currentId].metadata.detectedVibe}`);
}

function renderToggle() {
  const on = Boolean(engine?.isPlaying);
  toggle.setAttribute("aria-pressed", String(on));
  toggleLabel.textContent = on ? "Pausar" : "Reproducir";
  toggle.disabled = busy || !currentId;
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

async function selectPreset(id) {
  if (id === currentId) return;
  const wasPlaying = Boolean(engine?.isPlaying);
  currentId = id;
  presetButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.preset === id)));
  applyTheme(presets[id]);
  renderSeed(presets[id]);
  if (wasPlaying) {
    await withBusy(async () => {
      await teardown();
      await play();
    });
  } else {
    setStatus("Listo. Pulsa reproducir.");
    renderToggle();
  }
}

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
