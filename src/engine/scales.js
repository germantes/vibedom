// Teoría musical pura (sin Tone.js): notas, escalas y acordes en números MIDI.

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };

/** Intervalos en semitonos desde la tónica. */
export const SCALES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
});

/** "D", "Eb", "f#" → clase de altura 0-11. Lanza si no es una nota válida. */
export function pitchClass(note) {
  if (typeof note !== "string") throw new TypeError(`Nota inválida: ${note}`);
  const trimmed = note.trim();
  const name = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase().replace("♯", "#").replace("♭", "b");
  const sharp = FLAT_TO_SHARP[name] ?? name;
  const pc = SHARP_NAMES.indexOf(sharp);
  if (pc === -1) throw new RangeError(`Nota inválida: ${note}`);
  return pc;
}

/** Convención MIDI/Tone.js: 60 = C4. */
export function midiToNoteName(midi) {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function noteToMidi(pc, octave) {
  return (octave + 1) * 12 + pc;
}

function intervalsFor(scale) {
  const intervals = SCALES[scale];
  if (!intervals) throw new RangeError(`Escala desconocida: ${scale}`);
  return intervals;
}

/** MIDI del grado `step` de la escala (puede exceder la octava o ser negativo). */
export function scaleStepToMidi(rootMidi, scale, step) {
  const intervals = intervalsFor(scale);
  const n = intervals.length;
  const octaveShift = Math.floor(step / n);
  return rootMidi + octaveShift * 12 + intervals[((step % n) + n) % n];
}

/** Notas de la escala, ascendentes, desde la tónica en `octave` durante `octaves` octavas (incluye la tónica final). */
export function scaleMidi(rootNote, scale, octave, octaves = 1) {
  const rootMidi = noteToMidi(pitchClass(rootNote), octave);
  const n = intervalsFor(scale).length;
  const notes = [];
  for (let step = 0; step <= n * octaves; step++) notes.push(scaleStepToMidi(rootMidi, scale, step));
  return notes;
}

/**
 * Acorde diatónico apilando grados alternos (terceras en escalas heptatónicas;
 * en la pentatónica da voicings abiertos tipo cuartas/sextas).
 */
export function chordForDegree(rootNote, scale, octave, degree, size = 3) {
  const rootMidi = noteToMidi(pitchClass(rootNote), octave);
  const chord = [];
  for (let i = 0; i < size; i++) chord.push(scaleStepToMidi(rootMidi, scale, degree + i * 2));
  return chord;
}
