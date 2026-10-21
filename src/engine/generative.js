// Lógica generativa pura (sin Tone.js, RNG inyectable para tests):
// progresiones de acordes por cadena de Markov, voice leading y paseo melódico del arpegio.

import { SCALES, chordForDegree, scaleStepToMidi } from "./scales.js";

/** Elige un elemento según pesos (no hace falta que sumen 1). */
export function weightedPick(items, weights, rng = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Grados utilizables como acorde: se descartan los disminuidos (quinta de 6 semitonos). */
export function usableDegrees(scale) {
  const n = SCALES[scale].length;
  const degrees = [];
  for (let d = 0; d < n; d++) {
    const fifth = scaleStepToMidi(0, scale, d + 4) - scaleStepToMidi(0, scale, d);
    if (fifth !== 6) degrees.push(d);
  }
  return degrees;
}

/**
 * Siguiente grado de la progresión. Favorece movimientos "de cuarta/quinta" y de
 * tercera (ambient: cambios suaves), vuelve a la tónica con frecuencia y nunca repite.
 */
export function nextDegree(current, scale, rng = Math.random) {
  const n = SCALES[scale].length;
  const candidates = usableDegrees(scale).filter((d) => d !== current);
  const weights = candidates.map((d) => {
    const distance = (((d - current) % n) + n) % n;
    let w = 1;
    if (distance === 3 || distance === 4) w += 2; // IV / V relativos
    if (distance === 2 || distance === n - 2) w += 1.5; // terceras: notas comunes
    if (d === 0) w += 1.5; // gravedad hacia la tónica
    return w;
  });
  return weightedPick(candidates, weights, rng);
}

/** Acorde de pad: tétrada diatónica en `octave`, con voice leading respecto al anterior. */
export function padVoicing(rootNote, scale, octave, degree, previous) {
  const chord = chordForDegree(rootNote, scale, octave, degree, 4);
  return previous ? voiceLead(previous, chord) : chord;
}

/**
 * Transpone cada nota del acorde por octavas para que quede lo más cerca posible
 * del centro del voicing anterior (movimiento mínimo, sin saltos bruscos).
 */
export function voiceLead(previous, chord) {
  const center = previous.reduce((a, b) => a + b, 0) / previous.length;
  return chord
    .map((note) => {
      let best = note;
      for (let shift = -24; shift <= 24; shift += 12) {
        if (Math.abs(note + shift - center) < Math.abs(best - center)) best = note + shift;
      }
      return best;
    })
    .sort((a, b) => a - b);
}

/**
 * Paseo aleatorio por grados de la escala para el arpegio. Pasos cortos dominan,
 * los saltos son raros, y el rango [minStep, maxStep] actúa como pared elástica.
 * Si `chordSteps` contiene la nota resultante (módulo escala) gana peso: el arpegio
 * gravita hacia las notas del acorde que suena.
 */
export function nextArpStep(current, { scale, minStep, maxStep, chordSteps = [] }, rng = Math.random) {
  const n = SCALES[scale].length;
  const moves = [-3, -2, -1, 1, 2, 3, 4];
  const weights = moves.map((m) => {
    const target = current + m;
    if (target < minStep || target > maxStep) return 0;
    let w = { 1: 3, 2: 2.5, 3: 1, 4: 0.6 }[Math.abs(m)];
    const degree = ((target % n) + n) % n;
    if (chordSteps.includes(degree)) w *= 2;
    return w;
  });
  if (weights.every((w) => w === 0)) return Math.round((minStep + maxStep) / 2);
  return current + weightedPick(moves, weights, rng);
}

/**
 * Traduce la intensidad de scroll (0-1) a un valor del parámetro destino.
 * filterFreq se multiplica (percepción logarítmica); el resto se interpola hacia 1.
 */
export function modulate(target, base, intensity, multiplier) {
  const i = Math.min(1, Math.max(0, intensity));
  if (target === "filterFreq") return base * (1 + i * (multiplier - 1));
  const reach = Math.min(1, (multiplier - 1) / 4); // multiplier 1-5 → alcance 0-100%
  return base + (1 - base) * i * reach;
}
