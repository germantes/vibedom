// Panel de progreso del análisis: pasos simulados con reloj real.
// El backend hace scraper + Gemini en una sola petición, así que no hay progreso
// medible; este panel acompaña la espera sin mentir sobre el tiempo transcurrido.

const STEPS = [
  { at: 0, label: "Extrayendo paleta y tipografía" },
  { at: 2500, label: "Leyendo la estructura y el tono" },
  { at: 5000, label: "Traduciendo la estética a armonía" },
  { at: 8500, label: "Sintetizando la atmósfera" },
  { at: 13000, label: "Afinando el soundscape" },
];

export function createAnalysis({ root, stepEl, subEl, listEl, progressEl, cancelBtn, retryBtn }) {
  let raf = 0;
  let startedAt = 0;
  let active = false;
  let hideTimer = 0;

  function clearHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  const items = STEPS.map((step) => {
    const li = document.createElement("li");
    li.textContent = step.label;
    li.dataset.state = "pending";
    return li;
  });
  listEl.replaceChildren(...items);

  function paint(elapsed) {
    const progress = Math.min(96, 4 + 92 * (1 - Math.exp(-elapsed / 7500)));
    progressEl.style.width = `${progress}%`;

    let index = 0;
    for (let i = 0; i < STEPS.length; i++) if (elapsed >= STEPS[i].at) index = i;
    items.forEach((li, i) => {
      li.dataset.state = i < index ? "done" : i === index ? "active" : "pending";
    });

    stepEl.textContent = `${STEPS[index].label}…`;
    const seconds = Math.round(elapsed / 1000);
    if (elapsed < 3000) {
      subEl.textContent = "Descargando y analizando el HTML y las hojas de estilo.";
    } else if (elapsed < 8500) {
      subEl.textContent = "Gemini está convirtiendo la estética en una semilla sonora.";
    } else {
      subEl.textContent = `Seguimos esperando al modelo · ${seconds} s`;
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
      stepEl.textContent = `${STEPS[0].label}…`;
      subEl.textContent = "Descargando y analizando el HTML y las hojas de estilo.";
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
      stepEl.textContent = "Atmósfera lista";
      subEl.textContent = "La semilla sonora ya está generada.";
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
      stepEl.textContent = "No se pudo completar el análisis";
      subEl.textContent = message;
      cancelBtn.hidden = true;
      retryBtn.hidden = false;
    },

    cancel() {
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      stepEl.textContent = "Análisis cancelado";
      subEl.textContent = "Puedes probar con otra URL o reintentarlo.";
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
