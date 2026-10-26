// Motor procedural: interpreta una Semilla Sonora y la convierte en un soundscape infinito.
//
// Grafo de audio (optimizado para CPUs modestas):
//
//   drone (sine) ───────────────┐
//   pad (PolySynth fat*×2) → padFilter ─┤
//                                  ├→ chorus → reverb (Freeverb) → limiter → master → destination
//   arp (Synth) → arpFilter → delay ┘                                        ├→ analyser (onda)
//                                                                            └→ fft (espectro)
//
// Tone.js se inyecta (no se importa) para que el widget pueda cargarlo bajo demanda.

import { normalizeSeed } from "./seed.js";
import { SCALES, midiToNoteName, noteToMidi, pitchClass, scaleStepToMidi } from "./scales.js";
import { modulate, nextArpStep, nextDegree, padVoicing, usableDegrees } from "./generative.js";

const MASTER_DB = -4;
const FADE_IN_S = 2.5;
const FADE_OUT_S = 1.2;

/** Envolvente fat* para el pad: varias voces desafinadas = pad ancho y vivo. */
const fatWave = (waveform) => `fat${waveform}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let contextConfigured = false;

/**
 * Crea el AudioContext optimizado antes de cualquier scheduling (idealmente
 * dentro del primer gesto del usuario). Idempotente.
 */
export function configureContext(Tone) {
  if (contextConfigured) return;
  Tone.setContext(new Tone.Context({ latencyHint: "playback" }));
  Tone.getContext().lookAhead = 0.3; // margen amplio de scheduling: menos dropouts
  contextConfigured = true;
}

export async function createSoundscape(Tone, rawSeed, { rng = Math.random } = {}) {
  const seed = normalizeSeed(rawSeed);
  const { musicalParams: music, synthConfig: cfg } = seed;
  const { scale, rootNote, octave } = music;
  const scaleLength = SCALES[scale].length;
  const rootMidi = noteToMidi(pitchClass(rootNote), octave);

  // ---- Contexto optimizado para reproducción continua ----------------------
  configureContext(Tone);

  const transport = Tone.getTransport();
  transport.cancel();
  transport.bpm.value = music.bpm;

  // ---- Bus de salida -------------------------------------------------------
  const master = new Tone.Volume(-Infinity).toDestination();
  const analyser = new Tone.Analyser("waveform", 512);
  const fft = new Tone.Analyser({ type: "fft", size: 128, smoothing: 0.82 });
  master.connect(analyser);
  master.connect(fft);
  const limiter = new Tone.Limiter(-2).connect(master);
  // Freeverb (Schroeder): órdenes de magnitud más ligero que convolución (Tone.Reverb).
  const roomSize = 0.3 + 0.65 * (1 - Math.exp(-cfg.effects.reverbDecay / 6));
  const reverb = new Tone.Freeverb({ roomSize, dampening: 4000, wet: cfg.effects.reverbWet }).connect(limiter);
  const chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 4, depth: cfg.effects.chorusDepth, spread: 180, wet: 0.5 })
    .connect(reverb)
    .start();

  // ---- Capa 1: Pad + drone -------------------------------------------------
  const padFilter = new Tone.Filter({ type: "lowpass", frequency: cfg.pad.filterFreq, Q: 0.7, rolloff: -24 }).connect(chorus);
  const pad = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 8,
    volume: -16,
    oscillator: { type: fatWave(cfg.pad.waveform), count: 2, spread: 20 },
    envelope: { attack: cfg.pad.attack, decay: 1, sustain: 0.8, release: cfg.pad.release, attackCurve: "sine", releaseCurve: "exponential" },
  }).connect(padFilter);

  const drone = new Tone.Synth({
    volume: -20,
    oscillator: { type: "sine" },
    envelope: { attack: Math.max(2, cfg.pad.attack), decay: 0, sustain: 1, release: cfg.pad.release },
  }).connect(padFilter);

  // ---- Capa 2: Arpegio generativo -----------------------------------------
  const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.38, wet: cfg.arp.delayWet }).connect(chorus);
  const arpFilter = new Tone.Filter({ type: "lowpass", frequency: cfg.pad.filterFreq * 3, Q: 0.5 }).connect(delay);
  const arp = new Tone.Synth({
    volume: -15,
    oscillator: { type: cfg.arp.waveform },
    envelope: { attack: 0.008, decay: 0.35, sustain: 0.08, release: 1.4 },
  }).connect(arpFilter);

  // ---- Estado editable en caliente ----------------------------------------
  const state = {
    bpm: music.bpm,
    filterFreq: cfg.pad.filterFreq,
    reverbWet: cfg.effects.reverbWet,
    delayWet: cfg.arp.delayWet,
    arpDensity: cfg.arp.density,
  };

  const applyFilterFreq = (value) => {
    padFilter.frequency.rampTo(value, 0.15);
    arpFilter.frequency.rampTo(value * 3, 0.15);
  };
  const applyReverbWet = (value) => reverb.wet.rampTo(value, 0.2);
  const applyDelayWet = (value) => delay.wet.rampTo(value, 0.2);

  // ---- Secuenciación ------------------------------------------------------
  const secondsPerBar = () => (60 / state.bpm) * 4;
  const barsPerChord = Math.max(2, Math.ceil((cfg.pad.attack * 1.5 + 3) / secondsPerBar()));
  const chordSeconds = () => barsPerChord * secondsPerBar();

  let degree = 0;
  let voicing = null;
  let chordSteps = [0, 2, 4, 6];

  function triggerChord(time, { advance = true } = {}) {
    const played = degree;
    const length = chordSeconds();
    voicing = padVoicing(rootNote, scale, octave, degree, voicing);
    chordSteps = [0, 2, 4, 6].map((i) => (degree + i) % scaleLength);
    const velocity = 0.45 + rng() * 0.2;
    voicing.forEach((midi, i) => {
      pad.triggerAttackRelease(midiToNoteName(midi), length * 0.95, time + i * 0.06 * (1 + rng()), velocity);
    });
    if (advance) degree = nextDegree(degree, scale, rng);
    return played;
  }

  const padLoop = new Tone.Loop((time) => triggerChord(time), `${barsPerChord}m`);

  const droneLoop = new Tone.Loop((time) => {
    const step = rng() < 0.7 ? 0 : 4;
    drone.triggerAttackRelease(midiToNoteName(scaleStepToMidi(rootMidi - 12, scale, step)), chordSeconds() * 4 * 0.98, time, 0.6);
  }, `${barsPerChord * 4}m`);

  const arpRange = { scale, minStep: scaleLength, maxStep: scaleLength * 3 - 1 };
  let arpStep = scaleLength + Math.floor(rng() * scaleLength);
  let arpDensity = cfg.arp.density;

  const arpLoop = new Tone.Loop((time) => {
    if (rng() >= arpDensity) return;
    arpStep = nextArpStep(arpStep, { ...arpRange, chordSteps }, rng);
    const note = midiToNoteName(scaleStepToMidi(rootMidi, scale, arpStep));
    const length = rng() < 0.25 ? "4n" : "16n";
    arp.triggerAttackRelease(note, length, time, 0.25 + rng() * 0.45);
  }, "8n");
  arpLoop.humanize = "64n";

  // ---- Reactividad --------------------------------------------------------
  const scrollTargets = {
    filterFreq: applyFilterFreq,
    reverbWet: applyReverbWet,
    delayWet: applyDelayWet,
    arpDensity: (value) => {
      arpDensity = value;
    },
  };

  let lastHoverAt = 0;
  let playing = false;

  const nodes = [pad, drone, arp, padFilter, arpFilter, delay, chorus, reverb, limiter, analyser, fft, master];
  const loops = [padLoop, droneLoop, arpLoop];

  return {
    seed,
    analyser,
    fft,

    get isPlaying() {
      return playing;
    },

    get contextState() {
      return Tone.getContext().state;
    },

    /** Estado actual de los parámetros editables (para sincronizar la UI). */
    get params() {
      return { ...state };
    },

    /** Debe llamarse desde un gesto del usuario (política de autoplay). */
    async start() {
      if (playing) return;
      await Tone.start();
      playing = true;
      padLoop.start(0);
      droneLoop.start(0);
      if (cfg.arp.enabled) arpLoop.start(`${barsPerChord}m`);
      transport.position = 0;
      transport.start("+0.05");
      master.volume.rampTo(MASTER_DB, FADE_IN_S);
    },

    async stop() {
      if (!playing) return;
      playing = false;
      master.volume.rampTo(-Infinity, FADE_OUT_S);
      await new Promise((resolve) => setTimeout(resolve, FADE_OUT_S * 1000));
      if (playing) return;
      transport.stop();
      loops.forEach((loop) => loop.stop());
      pad.releaseAll();
      drone.triggerRelease();
    },

    /** Tempo en caliente (40-140 BPM). */
    setBpm(value) {
      state.bpm = clamp(Math.round(value), 40, 140);
      transport.bpm.rampTo(state.bpm, 0.2);
      return state.bpm;
    },

    /** Brillo: frecuencia de corte del pad (y del arpegio, atada a ×3). */
    setFilterFreq(value) {
      state.filterFreq = clamp(value, 80, 12000);
      applyFilterFreq(state.filterFreq);
      return state.filterFreq;
    },

    /** Espacialidad: mezcla de reverb (0-1). */
    setReverbWet(value) {
      state.reverbWet = clamp(value, 0, 1);
      applyReverbWet(state.reverbWet);
      return state.reverbWet;
    },

    /** Mezcla del delay del arpegio (0-1). */
    setDelayWet(value) {
      state.delayWet = clamp(value, 0, 1);
      applyDelayWet(state.delayWet);
      return state.delayWet;
    },

    /** Densidad melódica del arpegio (0-1). */
    setArpDensity(value) {
      state.arpDensity = clamp(value, 0, 1);
      arpDensity = state.arpDensity;
      return state.arpDensity;
    },

    /** Salta a un grado nuevo y dispara el acorde de inmediato (variación). */
    regenerate() {
      if (!playing) return null;
      const options = usableDegrees(scale).filter((d) => d !== degree);
      degree = options[Math.floor(rng() * options.length)] ?? 0;
      arpStep = scaleLength + Math.floor(rng() * scaleLength);
      const played = triggerChord(Tone.now() + 0.05);
      return { degree: played };
    },

    /** intensity 0-1 (0 = reposo). */
    setScrollIntensity(intensity) {
      const target = cfg.interactivity.scrollTarget;
      const value = modulate(target, state[target], intensity, cfg.interactivity.scrollMultiplier);
      scrollTargets[target](value);
    },

    /** Nota suave de la escala al pasar sobre elementos interactivos (con antirrebote). */
    hoverNote() {
      if (!playing || !cfg.interactivity.hoverNoteTrigger) return;
      const now = Tone.now();
      if (now - lastHoverAt < 0.12) return;
      lastHoverAt = now;
      const step = scaleLength * 2 + chordSteps[Math.floor(rng() * chordSteps.length)];
      arp.triggerAttackRelease(midiToNoteName(scaleStepToMidi(rootMidi, scale, step)), "16n", now, 0.2);
    },

    dispose() {
      playing = false;
      transport.stop();
      transport.cancel();
      loops.forEach((loop) => loop.dispose());
      nodes.forEach((node) => node.dispose());
    },
  };
}
