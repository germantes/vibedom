// Reproductor de los sound tests. Cada tarjeta llama a su semilla JSON bajo
// demanda (mismo origen, estático) y solo entonces importa Tone.js a través de
// widget-player.js. Sonando una tarjeta cada vez; cambiarla libera la previa.

const LABELS = {
  es: { play: "Escuchar", pause: "Pausar", loading: "Cargando…", error: "No se pudo cargar" },
  en: { play: "Play", pause: "Pause", loading: "Loading…", error: "Couldn't load" },
};

const buttons = [...document.querySelectorAll(".st-play")];
const playerUrl = "/widget-player.js";
let player = null;
let activeBtn = null;

function setLabel(button, text) {
  button.querySelector(".st-play-label").textContent = text;
}

async function stopActive() {
  if (!player) return;
  const toRelease = player;
  player = null;
  const previous = activeBtn;
  activeBtn = null;
  try {
    await toRelease.stop();
  } catch {
    // el dispose de abajo también limpia el transporte
  }
  try {
    toRelease.dispose();
  } catch {
    // ignorado: el botón vuelve a su estado de descanso de todos modos
  }
  if (previous) {
    previous.setAttribute("aria-pressed", "false");
    previous.classList.remove("loading");
    const labels = LABELS[previous.dataset.lang] ?? LABELS.es;
    setLabel(previous, labels.play);
  }
}

async function startCard(button) {
  const labels = LABELS[button.dataset.lang] ?? LABELS.es;
  button.classList.add("loading");
  setLabel(button, labels.loading);
  try {
    const [seed, mod] = await Promise.all([
      fetch(`/sound-tests/${button.dataset.slug}.${button.dataset.lang}.json`).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
      import(playerUrl),
    ]);
    player = await mod.createPlayer(seed);
    activeBtn = button;
    button.setAttribute("aria-pressed", "true");
    setLabel(button, labels.pause);
  } catch (error) {
    console.error("[vibedom] sound test:", error.message);
    setLabel(button, labels.error);
    setTimeout(() => setLabel(button, labels.play), 2500);
  } finally {
    button.classList.remove("loading");
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    if (activeBtn === button) {
      await stopActive();
      return;
    }
    if (player) await stopActive();
    await startCard(button);
  });
}
