// Validación de la "Semilla Sonora" (contrato JSON de la spec, sección 4).
// Política: tipos, enums y colores inválidos → SeedError con todos los problemas;
// números fuera de rango → se recortan al rango seguro (el LLM puede pasarse).

import { SCALES, pitchClass } from "./scales.js";

export const WAVEFORMS = Object.freeze(["sine", "triangle", "sawtooth", "square"]);
export const FONT_FAMILIES = Object.freeze(["serif", "sans-serif", "monospace", "display"]);
export const SCROLL_TARGETS = Object.freeze(["filterFreq", "reverbWet", "delayWet", "arpDensity"]);

/** [min, max] de cada parámetro numérico. */
export const RANGES = Object.freeze({
  "musicalParams.bpm": [40, 140],
  "musicalParams.octave": [2, 5],
  "synthConfig.pad.attack": [0.05, 10],
  "synthConfig.pad.release": [0.2, 15],
  "synthConfig.pad.filterFreq": [80, 12000],
  "synthConfig.arp.density": [0, 1],
  "synthConfig.arp.delayWet": [0, 1],
  "synthConfig.effects.reverbDecay": [0.5, 20],
  "synthConfig.effects.reverbWet": [0, 1],
  "synthConfig.effects.chorusDepth": [0, 1],
  "synthConfig.interactivity.scrollMultiplier": [1, 5],
});

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class SeedError extends Error {
  constructor(issues) {
    super(`Semilla sonora inválida:\n- ${issues.join("\n- ")}`);
    this.name = "SeedError";
    this.issues = issues;
  }
}

/** Devuelve una copia saneada de la semilla o lanza SeedError. */
export function normalizeSeed(input) {
  const issues = [];
  const at = (path) => path.split(".").reduce((obj, key) => (obj == null ? undefined : obj[key]), input);

  const string = (path) => {
    const value = at(path);
    if (typeof value !== "string") issues.push(`${path}: se esperaba texto`);
    return value;
  };
  const oneOf = (path, allowed) => {
    const value = at(path);
    if (!allowed.includes(value)) issues.push(`${path}: "${value}" no es uno de ${allowed.join(", ")}`);
    return value;
  };
  const color = (path) => {
    const value = at(path);
    if (typeof value !== "string" || !HEX_COLOR.test(value)) issues.push(`${path}: se esperaba color hex (#RRGGBB)`);
    return value;
  };
  const bool = (path) => {
    const value = at(path);
    if (typeof value !== "boolean") issues.push(`${path}: se esperaba booleano`);
    return value;
  };
  const number = (path) => {
    const value = at(path);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(`${path}: se esperaba número`);
      return value;
    }
    const [min, max] = RANGES[path];
    return Math.min(max, Math.max(min, value));
  };

  const rootNote = string("musicalParams.rootNote");
  if (typeof rootNote === "string") {
    try {
      pitchClass(rootNote);
    } catch {
      issues.push(`musicalParams.rootNote: "${rootNote}" no es una nota (C, D#, Eb…)`);
    }
  }

  const seed = {
    metadata: {
      url: string("metadata.url"),
      detectedVibe: string("metadata.detectedVibe"),
      explanation: string("metadata.explanation"),
    },
    uiTheme: {
      backgroundColor: color("uiTheme.backgroundColor"),
      accentColor: color("uiTheme.accentColor"),
      textColor: color("uiTheme.textColor"),
      fontFamily: oneOf("uiTheme.fontFamily", FONT_FAMILIES),
    },
    musicalParams: {
      bpm: number("musicalParams.bpm"),
      rootNote,
      scale: oneOf("musicalParams.scale", Object.keys(SCALES)),
      octave: Math.round(number("musicalParams.octave")),
    },
    synthConfig: {
      pad: {
        waveform: oneOf("synthConfig.pad.waveform", WAVEFORMS),
        attack: number("synthConfig.pad.attack"),
        release: number("synthConfig.pad.release"),
        filterFreq: number("synthConfig.pad.filterFreq"),
      },
      arp: {
        enabled: bool("synthConfig.arp.enabled"),
        waveform: oneOf("synthConfig.arp.waveform", WAVEFORMS),
        density: number("synthConfig.arp.density"),
        delayWet: number("synthConfig.arp.delayWet"),
      },
      effects: {
        reverbDecay: number("synthConfig.effects.reverbDecay"),
        reverbWet: number("synthConfig.effects.reverbWet"),
        chorusDepth: number("synthConfig.effects.chorusDepth"),
      },
      interactivity: {
        scrollTarget: oneOf("synthConfig.interactivity.scrollTarget", SCROLL_TARGETS),
        scrollMultiplier: number("synthConfig.interactivity.scrollMultiplier"),
        hoverNoteTrigger: bool("synthConfig.interactivity.hoverNoteTrigger"),
      },
    },
  };

  if (issues.length) throw new SeedError(issues);
  return seed;
}
