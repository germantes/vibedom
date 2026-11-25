import { attachReactivity } from "../engine/reactivity.js";
import { configureContext, createSoundscape } from "../engine/soundscape.js";
import { analysisCopy, applyI18n, getLang, presetCopy, rateLimitCopy, t } from "../i18n.js";
import { API_URL, CAN_SCAN, STATIC_HOST, TOP_URL, warmApi } from "../api.js";
import { addHistoryEntry, readHistory } from "../history.js";
import { buildShareLink, encodeShortToken, shortenShareLink } from "../embed.js";
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
// El enlace compartido apunta al origen con backend (vía /s/<token> llega al
// playground con la semilla ya puesta); en hosting estático cae a la propia.
const SHARE_ORIGIN = CAN_SCAN ? API_URL.origin : null;
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
const shareBtn = $("demo-share");
const scanForm = $("scan-form");
const scanBtn = $("scan-btn");
const urlInput = $("url-input");
const presetButtons = [...document.querySelectorAll(".preset")];
const historySection = $("history");
const historyList = $("history-list");
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

/** Copia al portapapeles con fallback a execCommand (navegadores sin permiso). */
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

shareBtn?.addEventListener("click", async () => {
  if (!activeSeed) return;
  // El enlace corto (ID en el servidor) es el bonito de compartir; si el
  // backend no responde, el token largo en la URL sigue funcionando igual.
  let link = buildShareLink(activeSeed, { origin: SHARE_ORIGIN, lang: getLang() });
  if (SHARE_ORIGIN) {
    try {
      const short = await shortenShareLink(encodeShortToken(activeSeed), SHARE_ORIGIN);
      link = getLang() === "en" ? `${short}?l=en` : short;
    } catch {
      // enlace largo: la copia no puede fallar por el acortador
    }
  }
  try {
    await copyText(link || location.href);
    flashLabel(shareBtn, "playground.share.copied", "playground.share.copy");
  } catch {
    flashLabel(shareBtn, "playground.share.error", "playground.share.copy");
  }
});

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

/** Copia visible: los presets se traducen; los escaneos ya llegan en su idioma. */
function seedVibe(seed) {
  return presetCopy(activePreset)?.detectedVibe ?? seed.metadata.detectedVibe;
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
  demoVibe.textContent = seedVibe(seed);
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
    const local = seed.metadata.source === "local";
    source.href = url;
    source.textContent = `${t("landing.demo.source")}: ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")}${
      local ? ` · ${t("source.local")}` : ""
    }`;
    source.title = local ? t("source.localTitle") : "";
    source.hidden = false;
  } else {
    source.hidden = true;
    source.removeAttribute("href");
    source.removeAttribute("title");
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
  const local = activeSeed.metadata?.source === "local";
  setStatus(t(local ? "status.playingLocal" : "status.playing", { vibe: seedVibe(activeSeed) }));
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
  // El enlace compartido solo tiene valor con una semilla propia (escaneo o
  // historial): con un preset cualquiera sería compartir la demo por defecto.
  if (shareBtn) shareBtn.hidden = presetId !== null;
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
      body: JSON.stringify({ url: target, lang: getLang() }),
      signal: scanController.signal,
    });

    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    const data = isJson ? await res.json() : {};
    if (!res.ok) {
      if (data.code === "RATE_LIMITED") {
        throw new Error(rateLimitCopy(data.retryAfter));
      }
      const fallback =
        res.status === 404 || res.status === 405
          ? t(CAN_SCAN ? "status.backendMissing" : "status.backendMissingStatic")
          : `Error ${res.status}`;
      throw new Error(data.error ?? fallback);
    }

    analysis.finish();
    // El ranking se refresca ya: el servidor espera el conteo de este escaneo.
    refreshTop();
    // El historial guarda la semilla para poder re-escuchar sin re-analizar.
    addHistoryEntry(window.localStorage, { url: target, seed: data });
    renderHistory();
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

// ---- Historial local -------------------------------------------------------

/**
 * Muestra los últimos escaneos de este navegador. Cada chip recarga la
 * semilla guardada y la reproduce: no se vuelve a gastar un análisis.
 */
function renderHistory() {
  if (!historySection) return;
  const entries = readHistory(window.localStorage);
  historySection.hidden = entries.length === 0;
  historyList.replaceChildren();

  for (const entry of entries) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "history-chip";
    chip.setAttribute(
      "aria-label",
      t("landing.history.replayAria", { host: entry.host || entry.url }),
    );

    const host = document.createElement("span");
    host.className = "history-host";
    host.textContent = entry.host || entry.url;

    chip.append(host);
    if (entry.vibe) {
      const vibe = document.createElement("span");
      vibe.className = "history-vibe";
      vibe.textContent = entry.vibe;
      chip.append(vibe);
    }

    chip.addEventListener("click", () =>
      withBusy(() => loadSeed(entry.seed, { autoplay: true, showSource: true })),
    );
    historyList.append(chip);
  }
}

renderHistory();

// ---- Ranking ---------------------------------------------------------------

const TOP_PERIODS = new Set(["today", "week", "month"]);
const TOP_CACHE_MS = 5 * 60_000;
const topSection = $("top");
const topPanel = $("top-panel");
const topList = $("top-list");
const topStatus = $("top-status");
const topTabs = [...document.querySelectorAll(".top-tab")];
const topCache = new Map();
let topPeriod = "month";
let topRequest = 0;

function topEndpoint(period) {
  const url = new URL(TOP_URL);
  url.searchParams.set("period", period);
  return url;
}

function renderTop(items) {
  const max = items.reduce((value, item) => Math.max(value, item.count), 0) || 1;
  topList.replaceChildren();

  items.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "top-item";
    // Barra proporcional al primero; el mínimo deja visible cualquier entrada.
    row.style.setProperty("--share", String(Math.max(0.08, item.count / max)));

    const rank = document.createElement("span");
    rank.className = "top-rank";
    rank.textContent = String(index + 1);

    const link = document.createElement("a");
    link.className = "top-host";
    link.href = `https://${item.host}`;
    link.target = "_blank";
    link.rel = "nofollow noopener noreferrer";
    link.textContent = item.host;
    link.setAttribute("aria-label", t("landing.top.openAria", { host: item.host }));

    // La cifra de escaneos se queda en el servidor: la barra comunica el orden.
    const bar = document.createElement("span");
    bar.className = "top-bar";
    bar.setAttribute("aria-hidden", "true");

    row.append(rank, link, bar);
    topList.append(row);
  });

  topList.hidden = items.length === 0;
  topStatus.textContent = items.length ? "" : t("landing.top.empty");
}

async function loadTop(period) {
  const cached = topCache.get(period);
  if (cached && Date.now() - cached.at < TOP_CACHE_MS) {
    renderTop(cached.items);
    return;
  }

  const request = ++topRequest;
  topList.setAttribute("aria-busy", "true");
  topStatus.textContent = t("landing.top.loading");

  try {
    const res = await fetch(topEndpoint(period), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();
    if (request !== topRequest) return;

    const items = Array.isArray(data.items)
      ? data.items.filter(
          (item) => item && typeof item.host === "string" && Number.isFinite(item.count),
        )
      : [];
    topCache.set(period, { at: Date.now(), items });
    renderTop(items);
  } catch (err) {
    if (request !== topRequest) return;
    console.warn("[vibedom] ranking no disponible:", err);
    topList.replaceChildren();
    topList.hidden = true;
    topStatus.textContent = t("landing.top.error");
  } finally {
    if (request === topRequest) topList.removeAttribute("aria-busy");
  }
}

function selectTopPeriod(period, { focus = false } = {}) {
  if (!TOP_PERIODS.has(period)) return;
  topPeriod = period;

  for (const tab of topTabs) {
    const active = tab.dataset.period === period;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }

  topPanel.setAttribute("aria-labelledby", `top-tab-${period}`);
  loadTop(period);
}

/**
 * Un escaneo recién terminado invalida la caché del ranking y lo recarga,
 * aunque la sección todavía no se haya acercado al viewport. El servidor
 * espera los conteos en vuelo antes de responder.
 */
function refreshTop() {
  if (!CAN_SCAN || !topSection) return;
  topCache.clear();
  selectTopPeriod(topPeriod);
}

function initTop() {
  if (!topSection) return;
  // Sin backend no hay ranking; la sección no llega a mostrarse.
  if (!CAN_SCAN) return;
  topSection.hidden = false;
  for (const tab of topTabs) {
    tab.addEventListener("click", () => selectTopPeriod(tab.dataset.period));
    tab.addEventListener("keydown", (event) => {
      let index;
      if (event.key === "ArrowLeft") index = (topTabs.indexOf(tab) - 1 + topTabs.length) % topTabs.length;
      else if (event.key === "ArrowRight") index = (topTabs.indexOf(tab) + 1) % topTabs.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = topTabs.length - 1;
      else return;
      event.preventDefault();
      selectTopPeriod(topTabs[index].dataset.period, { focus: true });
    });
  }

  // El ranking no bloquea la carga: se pide al acercarse a la sección.
  if (!("IntersectionObserver" in window)) {
    selectTopPeriod(topPeriod);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      selectTopPeriod(topPeriod);
    },
    { rootMargin: "200px" },
  );
  observer.observe(topSection);
}

initTop();

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
