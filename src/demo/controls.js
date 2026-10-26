// Controles manuales de ajuste fino. No llaman a la IA: mutan la semilla activa
// y, si el motor está sonando, aplican el cambio en caliente.

const FREQ_MIN = 80;
const FREQ_MAX = 12000;

const sliderToFreq = (position) => Math.round(FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** (position / 100));
const freqToSlider = (freq) => {
  const clamped = Math.min(FREQ_MAX, Math.max(FREQ_MIN, freq));
  return Math.round((Math.log(clamped / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN)) * 100);
};

export function formatHz(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} Hz`;
  return `${(value / 1000).toFixed(1)} kHz`;
}

const CONTROLS = [
  {
    key: "bpm",
    input: "ctl-bpm",
    output: "ctl-bpm-value",
    read: (seed) => seed.musicalParams.bpm,
    display: (seed) => seed.musicalParams.bpm,
    write: (seed, value) => {
      seed.musicalParams.bpm = value;
    },
    parse: (raw) => Number(raw),
    format: (value) => `${Math.round(value)} BPM`,
  },
  {
    key: "brightness",
    input: "ctl-brightness",
    output: "ctl-brightness-value",
    read: (seed) => freqToSlider(seed.synthConfig.pad.filterFreq),
    display: (seed) => seed.synthConfig.pad.filterFreq,
    write: (seed, value) => {
      seed.synthConfig.pad.filterFreq = value;
    },
    parse: (raw) => sliderToFreq(Number(raw)),
    format: (value) => formatHz(value),
  },
  {
    key: "spatiality",
    input: "ctl-spatiality",
    output: "ctl-spatiality-value",
    read: (seed) => Math.round(seed.synthConfig.effects.reverbWet * 100),
    display: (seed) => Math.round(seed.synthConfig.effects.reverbWet * 100),
    write: (seed, value) => {
      seed.synthConfig.effects.reverbWet = value / 100;
    },
    parse: (raw) => Number(raw),
    format: (value) => `${Math.round(value)}%`,
  },
  {
    key: "density",
    input: "ctl-density",
    output: "ctl-density-value",
    read: (seed) => Math.round(seed.synthConfig.arp.density * 100),
    display: (seed) => Math.round(seed.synthConfig.arp.density * 100),
    write: (seed, value) => {
      seed.synthConfig.arp.density = value / 100;
    },
    parse: (raw) => Number(raw),
    format: (value) => `${Math.round(value)}%`,
  },
];

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root        sección de controles
 * @param {(change: {key: string, value: number}) => void} opts.onChange
 * @param {() => void} opts.onRegenerate
 */
export function createControls({ root, onChange, onRegenerate }) {
  const rows = CONTROLS.map((control) => {
    const input = document.getElementById(control.input);
    const output = document.getElementById(control.output);
    const row = input.closest(".control");
    return { ...control, input, output, row };
  });
  const regenerateBtn = document.getElementById("regenerate");

  for (const row of rows) {
    row.input.addEventListener("input", () => {
      const value = row.parse(row.input.value);
      row.output.textContent = row.format(value);
      row.input.setAttribute("aria-valuetext", row.format(value));
      onChange({ key: row.key, value });
    });
  }

  regenerateBtn.addEventListener("click", onRegenerate);

  function setOutput(row, value) {
    row.output.textContent = row.format(value);
    row.input.setAttribute("aria-valuetext", row.format(value));
  }

  return {
    show() {
      root.hidden = false;
    },

    render(seed, { playing = false } = {}) {
      for (const row of rows) {
        row.input.value = String(row.read(seed));
        setOutput(row, row.display(seed));
      }

      const density = rows.find((row) => row.key === "density");
      const arpEnabled = seed.synthConfig.arp.enabled;
      density.input.disabled = !arpEnabled;
      density.row.classList.toggle("is-disabled", !arpEnabled);
      if (!arpEnabled) {
        density.output.textContent = "Arpegio off";
        density.input.setAttribute("aria-valuetext", "Arpegio desactivado en esta semilla");
      }

      regenerateBtn.disabled = !playing;
      root.hidden = false;
    },

    setPlaying(playing) {
      regenerateBtn.disabled = !playing;
    },

    /** Aplica el cambio a la semilla y devuelve el valor final. */
    write(seed, key, value) {
      const row = rows.find((item) => item.key === key);
      if (!row) return value;
      row.write(seed, value);
      return value;
    },
  };
}
