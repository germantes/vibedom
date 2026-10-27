// Compositor local determinista: señales estéticas → Semilla Sonora, sin IA.
//
// Gemini tiene una cuota gratuita por proyecto y, cuando se agota, el escaneo
// dejaría la demo muerta durante horas. Este módulo da una salida digna: aplica
// las mismas reglas de traducción del prompt (fondo, saturación, tipografía y
// movimiento) con aritmética pura.
//
// Garantías:
//   • misma web + mismas señales → misma semilla;
//   • el idioma solo cambia la copia visible, nunca la música;
//   • la salida pasa por normalizeSeed(), así que cumple el contrato.

import { normalizeSeed } from "../engine/seed.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALE_NAMES = {
  es: { major: "mayor", minor: "menor", dorian: "dórico", phrygian: "frigio", lydian: "lidio", pentatonic: "pentatónica" },
  en: { major: "major", minor: "minor", dorian: "dorian", phrygian: "phrygian", lydian: "lydian", pentatonic: "pentatonic" },
};

const FONT_NAMES = {
  es: { serif: "serif", "sans-serif": "sans-serif", monospace: "monoespaciada", display: "de display" },
  en: { serif: "serif", "sans-serif": "sans-serif", monospace: "monospace", display: "display" },
};

const FONT_VIBE = {
  es: { serif: "editorial", "sans-serif": "limpio", monospace: "técnico", display: "expresivo" },
  en: { serif: "editorial", "sans-serif": "clean", monospace: "technical", display: "expressive" },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** FNV-1a de 32 bits: barato, estable y suficiente para variar la semilla. */
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mezcla el hash con una sal para obtener decisiones independientes. */
function mix(hash, salt) {
  return hashText(`${hash}:${salt}`);
}

function pick(list, hash) {
  return list[hash % list.length];
}

function parseHex(value) {
  const match = String(value ?? "").trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((char) => char + char).join("");
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

function hexToRgb(hex) {
  const clean = parseHex(hex);
  if (!clean) return null;
  const digits = clean.slice(1);
  return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16));
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function saturation([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function mixRgb(a, b, amount) {
  return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount));
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/** Elige el color más "de acento": saturado y visible sobre el fondo. */
function pickAccent(colors, background, isDark, themeColor) {
  const seen = new Set();
  const candidates = [];
  for (const value of [...(colors ?? []), themeColor]) {
    const hex = parseHex(value);
    if (!hex || hex === background || seen.has(hex)) continue;
    seen.add(hex);
    candidates.push(hex);
  }

  let best = null;
  let bestScore = -1;
  for (const hex of candidates) {
    const rgb = hexToRgb(hex);
    const ratio = contrast(rgb, hexToRgb(background));
    if (ratio < 1.8) continue;
    // Saturación manda; el contraste desempata para no elegir un gris invisible.
    const score = saturation(rgb) * 2 + Math.min(ratio, 6) / 6;
    if (score > bestScore) {
      best = hex;
      bestScore = score;
    }
  }

  if (best) return best;
  // Sin paleta útil (CSS externo, ofuscado): derivamos un acento del fondo.
  return mixRgb(hexToRgb(background), isDark ? WHITE : BLACK, isDark ? 0.55 : 0.45);
}

/** Texto legible: primero un color real de la web; si no, blanco o negro. */
function pickText(colors, background) {
  const bg = hexToRgb(background);
  let best = null;
  let bestRatio = 4.4;
  const seen = new Set();

  for (const value of colors ?? []) {
    const hex = parseHex(value);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    const ratio = contrast(hexToRgb(hex), bg);
    if (ratio > bestRatio) {
      best = hex;
      bestRatio = ratio;
    }
  }

  return best ?? (luminance(bg) < 0.4 ? "#f4f1e8" : "#141414");
}

function resolveFont(fonts) {
  const categories = fonts?.categories ?? [];
  for (const candidate of ["display", "monospace", "serif", "sans-serif"]) {
    if (categories.includes(candidate)) return candidate;
  }
  return "sans-serif";
}

function buildMusic(hash, { isDark, saturated, pastel, font, animated, hasTransitions }) {
  const bpmBase = isDark ? 56 : 70;
  let bpm = bpmBase + pick([0, 3, 6, 9], mix(hash, "bpm"));
  if (animated) bpm += 10;
  else if (hasTransitions) bpm += 4;
  if (font === "serif") bpm -= 5;
  if (font === "display") bpm += 4;
  bpm = clamp(Math.round(bpm), 44, 104);

  const scalePool = isDark
    ? font === "monospace"
      ? ["phrygian", "minor", "dorian"]
      : font === "serif"
        ? ["dorian", "minor"]
        : ["minor", "dorian", "phrygian"]
    : font === "serif"
      ? ["lydian", "major"]
      : font === "display"
        ? ["pentatonic", "lydian", "major"]
        : ["major", "lydian", "pentatonic"];

  const rootNote = pick(NOTE_NAMES, mix(hash, "root"));
  const scale = pick(scalePool, mix(hash, "scale"));
  const octave = (isDark ? 2 : 3) + (mix(hash, "octave") % 2);

  const padPool = saturated
    ? isDark
      ? ["sawtooth", "square"]
      : ["square", "sawtooth"]
    : font === "serif"
      ? ["sine", "triangle"]
      : font === "monospace"
        ? ["triangle", "sawtooth"]
        : ["triangle", "sine"];
  const padWaveform = pick(padPool, mix(hash, "pad"));

  let filterFreq = isDark ? 320 + (mix(hash, "filter") % 480) : 1300 + (mix(hash, "filter") % 2100);
  if (font === "monospace") filterFreq *= 0.7;
  if (saturated) filterFreq += isDark ? 160 : 300;
  if (animated) filterFreq += 120;
  filterFreq = clamp(Math.round(filterFreq), 200, 6000);

  const attack = clamp(
    (isDark ? 1.5 : 0.8) + (mix(hash, "attack") % 25) / 10 + (font === "serif" ? 0.8 : 0),
    0.2,
    8,
  );
  const release = clamp(
    (font === "serif" ? 6 : isDark ? 4 : 2.5) + (mix(hash, "release") % 40) / 10,
    1,
    12,
  );
  const reverbDecay = clamp(
    (font === "serif" ? 6 : isDark ? 4 : 2.5) + (mix(hash, "decay") % 50) / 10,
    1,
    15,
  );
  const reverbWet = clamp(0.2 + (mix(hash, "wet") % 20) / 100 + (font === "serif" ? 0.24 : 0), 0, 1);
  const chorusDepth = clamp(
    saturated ? 0.35 + (mix(hash, "chorus") % 25) / 100 : 0.08 + (mix(hash, "chorus") % 18) / 100,
    0,
    1,
  );

  const arpEnabled = animated || hasTransitions || font === "display" || mix(hash, "arp") % 4 !== 0;
  let arpDensity;
  if (animated) arpDensity = 0.5 + (mix(hash, "density") % 21) / 100;
  else if (hasTransitions) arpDensity = 0.35 + (mix(hash, "density") % 21) / 100;
  else arpDensity = 0.12 + (mix(hash, "density") % 19) / 100;
  if (font === "serif") arpDensity *= 0.7;
  if (font === "display") arpDensity += 0.08;
  arpDensity = clamp(Number(arpDensity.toFixed(2)), 0, 1);

  const arpWaveform = pick(
    saturated ? ["square", "sawtooth"] : font === "serif" ? ["sine", "triangle"] : ["triangle", "sine"],
    mix(hash, "arp-wave"),
  );
  const delayWet = clamp(
    (saturated ? 0.35 : 0.15) + (mix(hash, "delay") % 25) / 100 + (isDark ? 0.03 : 0),
    0,
    1,
  );

  let scrollTarget;
  let scrollMultiplier;
  if (filterFreq < 1000) {
    scrollTarget = "filterFreq";
    scrollMultiplier = 2.5 + (mix(hash, "scroll") % 16) / 10;
  } else if (reverbWet >= 0.4) {
    scrollTarget = "reverbWet";
    scrollMultiplier = 2 + (mix(hash, "scroll") % 16) / 10;
  } else if (arpEnabled && arpDensity >= 0.4) {
    scrollTarget = "arpDensity";
    scrollMultiplier = 2 + (mix(hash, "scroll") % 16) / 10;
  } else {
    scrollTarget = "delayWet";
    scrollMultiplier = 1.5 + (mix(hash, "scroll") % 20) / 10;
  }

  return {
    bpm,
    rootNote,
    scale,
    octave,
    padWaveform,
    attack: Number(attack.toFixed(2)),
    release: Number(release.toFixed(2)),
    filterFreq,
    arpEnabled,
    arpWaveform,
    arpDensity,
    delayWet: Number(delayWet.toFixed(2)),
    reverbDecay: Number(reverbDecay.toFixed(1)),
    reverbWet: Number(reverbWet.toFixed(2)),
    chorusDepth: Number(chorusDepth.toFixed(2)),
    scrollTarget,
    scrollMultiplier: Number(clamp(scrollMultiplier, 1, 5).toFixed(1)),
    hoverNoteTrigger: true,
  };
}

function buildCopy(lang, { isDark, saturated, pastel, font, motion, music }) {
  const locale = lang === "en" ? "en" : "es";
  const scaleName = SCALE_NAMES[locale][music.scale];
  const fontName = FONT_NAMES[locale][font];
  const fontVibe = FONT_VIBE[locale][font];

  const filter =
    music.filterFreq < 1000
      ? { es: "filtro cerrado", en: "a closed filter" }[locale]
      : music.filterFreq < 2200
        ? { es: "filtro entreabierto", en: "a half-open filter" }[locale]
        : { es: "filtro abierto", en: "an open filter" }[locale];

  const arp = !music.arpEnabled
    ? { es: "sin arpegio", en: "no arpeggio" }[locale]
    : music.arpDensity >= 0.45
      ? { es: "arpegio denso", en: "a dense arpeggio" }[locale]
      : { es: "arpegio disperso", en: "a sparse arpeggio" }[locale];

  if (locale === "en") {
    const palette = saturated ? "saturated accents" : pastel ? "pastel tones" : "muted tones";
    const vibePalette = saturated ? "neon" : pastel ? "pastel" : "restrained";
    const tail = motion ? `${filter}, ${arp}, with a sense of movement` : `${filter} and ${arp}`;
    return {
      detectedVibe: `${isDark ? "Nocturnal" : "Luminous"}, ${vibePalette} and ${fontVibe}`,
      explanation: `A ${isDark ? "dark" : "light"} background, ${palette} and ${fontName} type become ${music.rootNote} ${scaleName} at ${music.bpm} BPM, ${tail}.`,
    };
  }

  const palette = saturated ? "acentos saturados" : pastel ? "tonos pastel" : "tonos apagados";
  const vibePalette = saturated ? "neón" : pastel ? "pastel" : "sobrio";
  const tail = motion ? `${filter}, ${arp} y una pizca de movimiento` : `${filter} y ${arp}`;
  return {
    detectedVibe: `${isDark ? "Nocturno" : "Luminoso"}, ${vibePalette} y ${fontVibe}`,
    explanation: `Un fondo ${isDark ? "oscuro" : "claro"}, ${palette} y tipografía ${fontName} se traducen en ${music.rootNote} ${scaleName} a ${music.bpm} BPM, ${tail}.`,
  };
}

/**
 * Convierte señales del scraper en una Semilla Sonora válida sin llamar a la IA.
 * Es determinista: la misma URL con las mismas señales produce la misma música.
 */
export function composeLocalSeed(signals = {}, { lang = "es" } = {}) {
  const colors = Array.isArray(signals.colors?.all) ? signals.colors.all : [];
  const background = parseHex(signals.colors?.background) ?? parseHex(signals.themeColor) ?? "#111111";
  const isDark =
    typeof signals.colors?.isDark === "boolean" ? signals.colors.isDark : luminance(hexToRgb(background)) < 0.4;
  const accent = pickAccent(colors, background, isDark, signals.themeColor);
  const text = pickText(colors, background);
  const font = resolveFont(signals.fonts);
  const animated = Boolean(signals.hasAnimations);
  const hasTransitions = Boolean(signals.hasTransitions);
  const motion = animated || hasTransitions;

  const accentRgb = hexToRgb(accent);
  const saturated = saturation(accentRgb) >= 0.55 && Math.max(...accentRgb) - Math.min(...accentRgb) >= 45;
  const pastel =
    !saturated &&
    saturation(accentRgb) >= 0.15 &&
    Math.max(...accentRgb) / 255 >= 0.55;

  // El hash incluye solo rasgos estables: ni el idioma ni el texto completo.
  const fingerprint = [
    signals.finalUrl ?? signals.url ?? "",
    signals.title ?? "",
    background,
    accent,
    text,
    font,
    animated ? "anim" : "",
    hasTransitions ? "trans" : "",
    ...colors,
  ].join("|");
  const hash = hashText(fingerprint);

  const music = buildMusic(hash, { isDark, saturated, pastel, font, animated, hasTransitions });
  const copy = buildCopy(lang, { isDark, saturated, pastel, font, motion, music });

  return normalizeSeed({
    metadata: {
      url: signals.finalUrl ?? signals.url ?? "",
      detectedVibe: copy.detectedVibe,
      explanation: copy.explanation,
    },
    uiTheme: {
      backgroundColor: background,
      accentColor: accent,
      textColor: text,
      fontFamily: font,
    },
    musicalParams: {
      bpm: music.bpm,
      rootNote: music.rootNote,
      scale: music.scale,
      octave: music.octave,
    },
    synthConfig: {
      pad: {
        waveform: music.padWaveform,
        attack: music.attack,
        release: music.release,
        filterFreq: music.filterFreq,
      },
      arp: {
        enabled: music.arpEnabled,
        waveform: music.arpWaveform,
        density: music.arpDensity,
        delayWet: music.delayWet,
      },
      effects: {
        reverbDecay: music.reverbDecay,
        reverbWet: music.reverbWet,
        chorusDepth: music.chorusDepth,
      },
      interactivity: {
        scrollTarget: music.scrollTarget,
        scrollMultiplier: music.scrollMultiplier,
        hoverNoteTrigger: music.hoverNoteTrigger,
      },
    },
  });
}
