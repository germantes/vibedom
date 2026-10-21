// Motor procedural: interpreta una Semilla Sonora y la convierte en un soundscape infinito.
//
// Grafo de audio:
//
//   drone (sine) ───────────────┐
//   pad (PolySynth fat*) → padFilter ─┤
//                               ├→ chorus → reverb → limiter → master → destination
//   arp (Synth) → arpFilter → delay ┘                                 └→ analyser
//   aire (ruido rosa) → airFilter ─────────→ reverb
//
// Tone.js se inyecta (no se importa) para que el widget pueda cargarlo bajo demanda.

import { normalizeSeed } from "./seed.js";
import { SCALES, midiToNoteName, noteToMidi, pitchClass, scaleStepToMidi } from "./scales.js";
import { modulate, nextArpStep, nextDegree, padVoicing } from "./generative.js";

const MASTER_DB = -4;
const FADE_IN_S = 2.5;
const FADE_OUT_S = 1.2;

/** Envolvente fat* para el pad: varias voces desafinadas = pad ancho y vivo. */
const fatWave = (waveform) => `fat${waveform}`;

export async function createSoundscape(Tone, rawSeed, { rng = Math.random } = {}) {
  const seed = normalizeSeed(rawSeed);
  const { musicalParams: music, synthConfig: cfg } = seed;
  const { scale, rootNote, octave } = music;
  const scaleLength = SCALES[scale].length;
  const rootMidi = noteToMidi(pitchClass(rootNote), octave);

  const transport = Tone.getTransport();
  transport.cancel();
  transport.bpm.value = music.bpm;

  // ---- Bus de salida -------------------------------------------------------
  const master = new Tone.Volume(-Infinity).toDestination();
  const analyser = new Tone.Analyser("waveform", 512);
  master.connect(analyser);
  const limiter = new Tone.Limiter(-2).connect(master);
  const reverb = new Tone.Reverb({ decay: cfg.effects.reverbDecay, preDelay: 0.03, wet: cfg.effects.reverbWet }).connect(limiter);
  const chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 4, depth: cfg.effects.chorusDepth, spread: 180, wet: 0.5 })
    .connect(reverb)
    .start();
  await reverb.ready; // el impulso se genera de forma asíncrona

  // ---- Capa 1: Pad + drone -------------------------------------------------
  const padFilter = new Tone.Filter({ type: "lowpass", frequency: cfg.pad.filterFreq, Q: 0.7, rolloff: -24 }).connect(chorus);
  // Respiración lenta del filtro en cents para no pelear con la modulación por scroll (que mueve frequency).
  const padBreath = new Tone.LFO({ frequency: 0.04 + rng() * 0.03, min: -500, max: 500 }).connect(padFilter.detune).start();
  const pad = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    volume: -16,
    oscillator: { type: fatWave(cfg.pad.waveform), count: 3, spread: 24 },
    envelope: { attack: cfg.pad.attack, decay: 1, sustain: 0.8, release: cfg.pad.release, attackCurve: "sine", releaseCurve: "exponential" },
  }).connect(padFilter);

  const drone = new Tone.Synth({
    volume: -20,
    oscillator: { type: "sine" },
    envelope: { attack: Math.max(2, cfg.pad.attack), decay: 0, sustain: 1, release: cfg.pad.release },
  }).connect(padFilter);

  // Capa de "aire": ruido rosa muy bajo y filtrado, da cuerpo y continuidad entre acordes.
  const airFilter = new Tone.AutoFilter({ frequency: 0.05, baseFrequency: 300, octaves: 3, depth: 0.8, wet: 1 }).connect(reverb).start();
  const air = new Tone.Noise({ type: "pink", volume: -44 }).connect(airFilter);

  // ---- Capa 2: Arpegio generativo -----------------------------------------
  const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.38, wet: cfg.arp.delayWet }).connect(chorus);
  const arpFilter = new Tone.Filter({ type: "lowpass", frequency: cfg.pad.filterFreq * 3, Q: 0.5 }).connect(delay);
  const arp = new Tone.Synth({
    volume: -15,
    oscillator: { type: cfg.arp.waveform },
    envelope: { attack: 0.008, decay: 0.35, sustain: 0.08, release: 1.4 },
  }).connect(arpFilter);

  // ---- Secuenciación ------------------------------------------------------
  const secondsPerBar = (60 / music.bpm) * 4;
  // Cada acorde dura lo bastante para que el ataque complete y el pad "respire".
  const barsPerChord = Math.max(2, Math.ceil((cfg.pad.attack * 1.5 + 3) / secondsPerBar));
  const chordSeconds = barsPerChord * secondsPerBar;

  let degree = 0;
  let voicing = null;
  let chordSteps = [0, 2, 4, 6];

  const padLoop = new Tone.Loop((time) => {
    voicing = padVoicing(rootNote, scale, octave, degree, voicing);
    chordSteps = [0, 2, 4, 6].map((i) => (degree + i) % scaleLength);
    const velocity = 0.45 + rng() * 0.2;
    // Las notas se escalonan unos ms (strum lento) para que no ataquen como un bloque.
    voicing.forEach((midi, i) => {
      pad.triggerAttackRelease(midiToNoteName(midi), chordSeconds * 0.95, time + i * 0.06 * (1 + rng()), velocity);
    });
    degree = nextDegree(degree, scale, rng);
  }, `${barsPerChord}m`);

  // El drone cambia cada 4 acordes entre tónica y quinta, una octava por debajo del pad.
  const droneLoop = new Tone.Loop((time) => {
    const step = rng() < 0.7 ? 0 : 4;
    drone.triggerAttackRelease(midiToNoteName(scaleStepToMidi(rootMidi - 12, scale, step)), chordSeconds * 4 * 0.98, time, 0.6);
  }, `${barsPerChord * 4}m`);

  const arpRange = { scale, minStep: scaleLength, maxStep: scaleLength * 3 - 1 }; // una y dos octavas sobre el pad
  let arpStep = scaleLength + Math.floor(rng() * scaleLength);
  let arpDensity = cfg.arp.density;

  const arpLoop = new Tone.Loop((time) => {
    if (rng() >= arpDensity) return;
    arpStep = nextArpStep(arpStep, { ...arpRange, chordSteps }, rng);
    const note = midiToNoteName(scaleStepToMidi(rootMidi, scale, arpStep));
    const length = rng() < 0.25 ? "4n" : "16n";
    arp.triggerAttackRelease(note, length, time, 0.25 + rng() * 0.45);
  }, "8n");
  arpLoop.humanize = "64n"; // micro-desplazamientos: suena tocado, no cuantizado

  // ---- Reactividad --------------------------------------------------------
  const scrollTargets = {
    filterFreq: (v) => {
      padFilter.frequency.rampTo(v, 0.2);
      arpFilter.frequency.rampTo(v * 3, 0.2);
    },
    reverbWet: (v) => reverb.wet.rampTo(v, 0.3),
    delayWet: (v) => delay.wet.rampTo(v, 0.3),
    arpDensity: (v) => {
      arpDensity = v;
    },
  };
  const scrollBase = {
    filterFreq: cfg.pad.filterFreq,
    reverbWet: cfg.effects.reverbWet,
    delayWet: cfg.arp.delayWet,
    arpDensity: cfg.arp.density,
  }[cfg.interactivity.scrollTarget];

  let lastHoverAt = 0;
  let playing = false;

  const nodes = [pad, drone, arp, air, airFilter, padBreath, padFilter, arpFilter, delay, chorus, reverb, limiter, analyser, master];
  const loops = [padLoop, droneLoop, arpLoop];

  return {
    seed,
    analyser,
    get isPlaying() {
      return playing;
    },

    /** Debe llamarse desde un gesto del usuario (política de autoplay). */
    async start() {
      if (playing) return;
      await Tone.start();
      playing = true;
      padLoop.start(0);
      droneLoop.start(0);
      if (cfg.arp.enabled) arpLoop.start(`${barsPerChord}m`); // el arpegio entra cuando el pad ya ha florecido
      air.start();
      transport.position = 0; // reanudar siempre desde el inicio: el pad entra de inmediato
      transport.start("+0.05");
      master.volume.rampTo(MASTER_DB, FADE_IN_S);
    },

    async stop() {
      if (!playing) return;
      playing = false;
      master.volume.rampTo(-Infinity, FADE_OUT_S);
      await new Promise((resolve) => setTimeout(resolve, FADE_OUT_S * 1000));
      if (playing) return; // se reanudó durante el fade
      transport.stop();
      loops.forEach((loop) => loop.stop());
      pad.releaseAll();
      drone.triggerRelease();
      air.stop();
    },

    /** intensity 0-1 (0 = reposo). */
    setScrollIntensity(intensity) {
      const value = modulate(cfg.interactivity.scrollTarget, scrollBase, intensity, cfg.interactivity.scrollMultiplier);
      scrollTargets[cfg.interactivity.scrollTarget](value);
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
