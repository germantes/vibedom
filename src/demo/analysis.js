// Panel de progreso del análisis: pasos simulados con reloj real.
// El backend hace scraper + Gemini en una sola petición, así que no hay progreso
// medible; este panel acompaña la espera sin mentir sobre el tiempo transcurrido.

const TIMINGS = [0, 2500, 5000, 8500, 13000];

const DEFAULT_COPY = {
  steps: [
    "Extrayendo paleta y tipografía",
    "Leyendo la estructura y el tono",
    "Traduciendo la estética a armonía",
    "Sintetizando la atmósfera",
    "Afinando el soundscape",
  ],
  download: "Descargando y analizando el HTML y las hojas de estilo.",
  translate: "Gemini está convirtiendo la estética en una semilla sonora.",
  waiting: (seconds) => `Seguimos esperando al modelo · ${seconds} s`,
  doneTitle: "Atmósfera lista",
  doneSub: "La semilla sonora ya está generada.",
  failTitle: "No se pudo completar el análisis",
  cancelTitle: "Análisis cancelado",
  cancelSub: "Puedes probar con otra URL o reintentarlo.",
};

export function createAnalysis({
  root,
  stepEl,
  subEl,
  listEl,
  progressEl,
  cancelBtn,
  retryBtn,
  copy = DEFAULT_COPY,
}) {
  let raf = 0;
  let startedAt = 0;
  let active = false;
  let hideTimer = 0;

  const text = { ...DEFAULT_COPY, ...copy, steps: copy.steps ?? DEFAULT_COPY.steps };

  function clearHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  const items = text.steps.map((label) => {
    const li = document.createElement("li");
    li.textContent = label;
    li.dataset.state = "pending";
    return li;
  });
  listEl.replaceChildren(...items);

  function paint(elapsed) {
    const progress = Math.min(96, 4 + 92 * (1 - Math.exp(-elapsed / 7500)));
    progressEl.style.width = `${progress}%`;

    let index = 0;
    for (let i = 0; i < TIMINGS.length; i++) if (elapsed >= TIMINGS[i]) index = i;
    items.forEach((li, i) => {
      li.dataset.state = i < index ? "done" : i === index ? "active" : "pending";
    });

    stepEl.textContent = `${text.steps[index]}…`;
    const seconds = Math.round(elapsed / 1000);
    if (elapsed < 3000) {
      subEl.textContent = text.download;
    } else if (elapsed < 8500) {
      subEl.textContent = text.translate;
    } else {
      subEl.textContent = text.waiting(seconds);
    }
  }

  function tick() {
    if (!active) return;
    paint(performance.now() - startedAt);
    raf = requestAnimationFrame(tick);
  }

  function reset() {
    cancelAnimationFrame(raf);
    clearHideTimer();
    raf = 0;
    active = false;
    root.classList.remove("is-error", "is-done", "is-active");
    items.forEach((li) => {
      li.dataset.state = "pending";
    });
    progressEl.style.width = "0%";
    cancelBtn.hidden = true;
    cancelBtn.disabled = false;
    retryBtn.hidden = true;
  }

  return {
    get active() {
      return active;
    },

    start() {
      reset();
      root.hidden = false;
      root.classList.add("is-active");
      active = true;
      startedAt = performance.now();
      stepEl.textContent = `${text.steps[0]}…`;
      subEl.textContent = text.download;
      progressEl.style.width = "4%";
      cancelBtn.hidden = false;
      tick();
    },

    finish() {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      progressEl.style.width = "100%";
      items.forEach((li) => {
        li.dataset.state = "done";
      });
      stepEl.textContent = text.doneTitle;
      subEl.textContent = text.doneSub;
      cancelBtn.hidden = true;
      root.classList.add("is-done");
    },

    fail(message) {
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      root.hidden = false;
      root.classList.add("is-error");
      items.forEach((li) => {
        if (li.dataset.state === "active") li.dataset.state = "pending";
      });
      progressEl.style.width = "100%";
      stepEl.textContent = text.failTitle;
      subEl.textContent = message;
      cancelBtn.hidden = true;
      retryBtn.hidden = false;
    },

    cancel() {
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      stepEl.textContent = text.cancelTitle;
      subEl.textContent = text.cancelSub;
      cancelBtn.hidden = true;
      retryBtn.hidden = false;
      progressEl.style.width = "0%";
    },

    hide() {
      clearHideTimer();
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      root.hidden = true;
    },

    /** Oculta el panel tras un respiro; un nuevo análisis cancela el temporizador. */
    hideSoon(delay = 1000) {
      clearHideTimer();
      hideTimer = setTimeout(() => {
        hideTimer = 0;
        this.hide();
      }, delay);
    },
  };
}
