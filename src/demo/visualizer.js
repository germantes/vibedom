// Visualizador: espectro de barras + osciloscopio, ambos reactivos a la paleta escaneada.
// Cada canvas se mide por separado, así el layout puede apilarlos o ponerlos en fila.
// Se dibuja en CSS pixels con el backing store escalado por devicePixelRatio.

const BARS = 48;

export function createVisualizer({ spectrumCanvas, scopeCanvas, getEngine }) {
  const spectrum = spectrumCanvas.getContext("2d");
  const scope = scopeCanvas.getContext("2d");
  const levels = new Float32Array(BARS);
  const spectrumSize = { width: 1, height: 1 };
  const scopeSize = { width: 1, height: 1 };
  let dpr = 1;
  let raf = 0;
  let accent = "#888888";
  let text = "#eeeeee";

  function fit(canvas, ctx, size) {
    const rect = canvas.getBoundingClientRect();
    size.width = Math.max(1, Math.round(rect.width));
    size.height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    fit(spectrumCanvas, spectrum, spectrumSize);
    fit(scopeCanvas, scope, scopeSize);
  }

  function drawIdle() {
    const { width, height } = spectrumSize;
    spectrum.clearRect(0, 0, width, height);

    const gap = 2;
    const barWidth = Math.max(1, (width - gap * (BARS - 1)) / BARS);
    spectrum.globalAlpha = 0.18;
    spectrum.fillStyle = text;
    for (let i = 0; i < BARS; i++) {
      spectrum.fillRect(i * (barWidth + gap), height - 2, barWidth, 2);
    }
    spectrum.globalAlpha = 1;

    const scopeBox = scopeSize;
    scope.clearRect(0, 0, scopeBox.width, scopeBox.height);
    scope.globalAlpha = 0.22;
    scope.strokeStyle = text;
    scope.lineWidth = 1;
    scope.beginPath();
    scope.moveTo(0, scopeBox.height / 2);
    scope.lineTo(scopeBox.width, scopeBox.height / 2);
    scope.stroke();
    scope.globalAlpha = 1;
  }

  function drawSpectrum(values) {
    const { width, height } = spectrumSize;
    const gap = 2;
    const barWidth = Math.max(1, (width - gap * (BARS - 1)) / BARS);
    const bins = values.length || 1;

    spectrum.clearRect(0, 0, width, height);
    spectrum.fillStyle = accent;

    for (let i = 0; i < BARS; i++) {
      // Reparto exponencial: más barras para las frecuencias bajas, donde vive la música.
      const start = Math.floor((i / BARS) ** 2 * bins);
      const end = Math.max(start + 1, Math.floor(((i + 1) / BARS) ** 2 * bins));
      let peak = -100;
      for (let bin = start; bin < end && bin < bins; bin++) {
        const value = values[bin];
        if (Number.isFinite(value) && value > peak) peak = value;
      }

      const normalized = Math.min(1, Math.max(0, (peak + 92) / 72));
      const target = normalized ** 1.5;
      levels[i] += (target - levels[i]) * 0.22;
      if (levels[i] < 0.004) levels[i] = 0;

      const barHeight = Math.max(1.5, levels[i] * (height - 6));
      const x = i * (barWidth + gap);
      const y = height - barHeight;

      spectrum.globalAlpha = 0.28 + levels[i] * 0.5;
      spectrum.fillRect(x, y, barWidth, barHeight);

      // Remate brillante en la punta de la barra.
      spectrum.globalAlpha = 0.85;
      spectrum.fillRect(x, y, barWidth, Math.min(2, barHeight));
    }
    spectrum.globalAlpha = 1;
  }

  function drawScope(values) {
    const { width, height } = scopeSize;
    scope.clearRect(0, 0, width, height);
    scope.strokeStyle = accent;
    scope.lineWidth = 1.6;
    scope.globalAlpha = 0.9;
    scope.shadowColor = accent;
    scope.shadowBlur = 7;
    scope.beginPath();

    const step = Math.max(1, Math.ceil(values.length / Math.max(1, width)));
    const count = Math.ceil(values.length / step);
    const mid = height / 2;
    for (let i = 0, x = 0; i < values.length; i += step, x++) {
      const px = count > 1 ? (x / (count - 1)) * width : 0;
      const py = mid - values[i] * height * 0.55;
      if (x === 0) scope.moveTo(px, py);
      else scope.lineTo(px, py);
    }
    scope.stroke();
    scope.shadowBlur = 0;
    scope.globalAlpha = 1;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const engine = getEngine();
    if (!engine?.isPlaying) {
      for (let i = 0; i < BARS; i++) levels[i] *= 0.9;
      drawIdle();
      return;
    }

    const fft = engine.fft?.getValue();
    const wave = engine.analyser?.getValue();
    if (fft?.length) drawSpectrum(fft);
    if (wave?.length) drawScope(wave);
  }

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(resize);
    observer.observe(spectrumCanvas);
    observer.observe(scopeCanvas);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();
  raf = requestAnimationFrame(frame);

  return {
    setColors({ accent: nextAccent, text: nextText }) {
      accent = nextAccent;
      text = nextText;
    },

    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
