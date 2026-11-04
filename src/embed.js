// Compartir la Semilla Sonora: enlace con la semilla incrustada y snippet del widget.
//
// En ambos casos los datos viajan en el propio enlace/código: no hay backend, no
// hay base de datos y cada visitante escucha la misma variación sin llamar a la IA.
//
// El enlace compartido usa un formato binario corto (`~` + base64url). Deja
// fuera la `explanation` (prosa de la IA) para que la URL no mida ~1 KB; la
// música, el tema, la URL y el `detectedVibe` se conservan. Los enlaces
// antiguos (base64url del JSON completo) se siguen leyendo.

import { FONT_FAMILIES, SCROLL_TARGETS, WAVEFORMS } from "./engine/seed.js";
import { SCALES } from "./engine/scales.js";

export const DEFAULT_WIDGET_BASE = "https://vibedom.dev";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHORT_PREFIX = "~";
const SHORT_VERSION = 1;
// El orden de los enums es parte del formato binario: no lo cambies sin
// subir SHORT_VERSION y mantener la lectura de la versión anterior.
const SCALE_NAMES = Object.keys(SCALES);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function bytesToBinary(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

function binaryToBytes(binary) {
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64Url(bytes) {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return binaryToBytes(atob(padded));
}

/** JSON → UTF-8 → base64, seguro dentro de un atributo HTML. */
export function encodeSeed(seed) {
  return btoa(bytesToBinary(new TextEncoder().encode(JSON.stringify(seed))));
}

/** Formato antiguo: JSON completo → UTF-8 → base64url. Se mantiene para leer enlaces ya compartidos. */
export function encodeShareToken(seed) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(seed)));
}

/** Formato antiguo: base64url → JSON. Lanza si el token está corrupto o no es JSON. */
export function decodeShareToken(token) {
  const value = String(token ?? "").trim();
  if (!BASE64URL.test(value)) throw new Error("Token de semilla inválido");

  let json;
  try {
    json = new TextDecoder().decode(fromBase64Url(value));
  } catch {
    throw new Error("Token de semilla inválido");
  }
  return JSON.parse(json);
}

// ---- Formato corto ---------------------------------------------------------

function writeVarint(out, value) {
  let n = Math.max(0, Math.floor(value));
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
}

function readVarint(bytes, state) {
  let result = 0;
  let shift = 0;
  while (state.i < bytes.length) {
    const byte = bytes[state.i++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return result;
    shift += 7;
    if (shift > 28) break;
  }
  throw new Error("Token de semilla inválido");
}

function writeString(out, encoder, value) {
  const data = encoder.encode(String(value ?? ""));
  writeVarint(out, data.length);
  for (const byte of data) out.push(byte);
}

function readString(bytes, state) {
  const length = readVarint(bytes, state);
  if (state.i + length > bytes.length) throw new Error("Token de semilla inválido");
  const data = bytes.subarray(state.i, state.i + length);
  state.i += length;
  return UTF8.decode(data);
}

function writeNumber(out, encoder, value) {
  // Texto: conserva exactamente el decimal que produjo la IA o el preset.
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Token de semilla inválido");
  }
  writeString(out, encoder, String(value));
}

function readNumber(bytes, state) {
  const value = Number(readString(bytes, state));
  if (!Number.isFinite(value)) throw new Error("Token de semilla inválido");
  return value;
}

function writeEnum(out, allowed, value) {
  const index = allowed.indexOf(value);
  if (index < 0) throw new Error("Token de semilla inválido");
  out.push(index);
}

function readEnum(bytes, state, allowed) {
  if (state.i >= bytes.length) throw new Error("Token de semilla inválido");
  const value = allowed[bytes[state.i++]];
  if (value === undefined) throw new Error("Token de semilla inválido");
  return value;
}

function readByte(bytes, state) {
  if (state.i >= bytes.length) throw new Error("Token de semilla inválido");
  return bytes[state.i++];
}

function readBool(bytes, state) {
  const value = readByte(bytes, state);
  if (value !== 0 && value !== 1) throw new Error("Token de semilla inválido");
  return value === 1;
}

/** Semilla → binario compacto (sin la explicación larga). */
function packShortSeed(seed) {
  const encoder = new TextEncoder();
  const out = [];
  const m = seed.metadata ?? {};
  const u = seed.uiTheme ?? {};
  const p = seed.musicalParams ?? {};
  const s = seed.synthConfig ?? {};
  const pad = s.pad ?? {};
  const arp = s.arp ?? {};
  const effects = s.effects ?? {};
  const interaction = s.interactivity ?? {};

  out.push(SHORT_VERSION);
  writeString(out, encoder, m.url);
  writeString(out, encoder, m.detectedVibe);
  writeString(out, encoder, m.source ?? "");
  out.push(m.unreadable === true ? 1 : 0);

  writeString(out, encoder, u.backgroundColor);
  writeString(out, encoder, u.accentColor);
  writeString(out, encoder, u.textColor);
  writeEnum(out, FONT_FAMILIES, u.fontFamily);

  writeNumber(out, encoder, p.bpm);
  writeString(out, encoder, p.rootNote);
  writeEnum(out, SCALE_NAMES, p.scale);
  writeNumber(out, encoder, p.octave);

  writeEnum(out, WAVEFORMS, pad.waveform);
  writeNumber(out, encoder, pad.attack);
  writeNumber(out, encoder, pad.release);
  writeNumber(out, encoder, pad.filterFreq);

  writeEnum(out, WAVEFORMS, arp.waveform);
  out.push(arp.enabled ? 1 : 0);
  writeNumber(out, encoder, arp.density);
  writeNumber(out, encoder, arp.delayWet);

  writeNumber(out, encoder, effects.reverbDecay);
  writeNumber(out, encoder, effects.reverbWet);
  writeNumber(out, encoder, effects.chorusDepth);

  writeEnum(out, SCROLL_TARGETS, interaction.scrollTarget);
  out.push(interaction.hoverNoteTrigger ? 1 : 0);
  writeNumber(out, encoder, interaction.scrollMultiplier);

  return Uint8Array.from(out);
}

/** Binario compacto → semilla. La explicación se rellena en el cliente. */
function unpackShortSeed(bytes) {
  const state = { i: 0 };
  if (readByte(bytes, state) !== SHORT_VERSION) throw new Error("Token de semilla inválido");

  const seed = {
    metadata: {
      url: readString(bytes, state),
      detectedVibe: readString(bytes, state),
      explanation: "",
    },
    uiTheme: {},
    musicalParams: {},
    synthConfig: {
      pad: {},
      arp: {},
      effects: {},
      interactivity: {},
    },
  };

  const source = readString(bytes, state);
  if (source) seed.metadata.source = source;
  if (readBool(bytes, state)) seed.metadata.unreadable = true;

  seed.uiTheme.backgroundColor = readString(bytes, state);
  seed.uiTheme.accentColor = readString(bytes, state);
  seed.uiTheme.textColor = readString(bytes, state);
  seed.uiTheme.fontFamily = readEnum(bytes, state, FONT_FAMILIES);

  seed.musicalParams.bpm = readNumber(bytes, state);
  seed.musicalParams.rootNote = readString(bytes, state);
  seed.musicalParams.scale = readEnum(bytes, state, SCALE_NAMES);
  seed.musicalParams.octave = readNumber(bytes, state);

  seed.synthConfig.pad.waveform = readEnum(bytes, state, WAVEFORMS);
  seed.synthConfig.pad.attack = readNumber(bytes, state);
  seed.synthConfig.pad.release = readNumber(bytes, state);
  seed.synthConfig.pad.filterFreq = readNumber(bytes, state);

  seed.synthConfig.arp.waveform = readEnum(bytes, state, WAVEFORMS);
  seed.synthConfig.arp.enabled = readBool(bytes, state);
  seed.synthConfig.arp.density = readNumber(bytes, state);
  seed.synthConfig.arp.delayWet = readNumber(bytes, state);

  seed.synthConfig.effects.reverbDecay = readNumber(bytes, state);
  seed.synthConfig.effects.reverbWet = readNumber(bytes, state);
  seed.synthConfig.effects.chorusDepth = readNumber(bytes, state);

  seed.synthConfig.interactivity.scrollTarget = readEnum(bytes, state, SCROLL_TARGETS);
  seed.synthConfig.interactivity.hoverNoteTrigger = readBool(bytes, state);
  seed.synthConfig.interactivity.scrollMultiplier = readNumber(bytes, state);

  if (state.i !== bytes.length) throw new Error("Token de semilla inválido");
  return seed;
}

/** Semilla → token corto (`~` + base64url). */
export function encodeShortToken(seed) {
  return `${SHORT_PREFIX}${toBase64Url(packShortSeed(seed))}`;
}

/** Token corto → semilla. Lanza si el prefijo, la versión o el binario no cuadran. */
export function decodeShortToken(token) {
  const value = String(token ?? "").trim();
  if (!value.startsWith(SHORT_PREFIX)) throw new Error("Token de semilla inválido");
  const payload = value.slice(SHORT_PREFIX.length);
  if (!BASE64URL.test(payload)) throw new Error("Token de semilla inválido");

  let bytes;
  try {
    bytes = fromBase64Url(payload);
  } catch {
    throw new Error("Token de semilla inválido");
  }
  try {
    return unpackShortSeed(bytes);
  } catch {
    throw new Error("Token de semilla inválido");
  }
}

/** Acepta el formato corto actual y el base64url antiguo. */
export function decodeAnyToken(token) {
  const value = String(token ?? "").trim();
  return value.startsWith(SHORT_PREFIX) ? decodeShortToken(value) : decodeShareToken(value);
}

/** `#seed=...` listo para añadir a la URL del playground. */
export function buildShareHash(seed) {
  return `#seed=${encodeShortToken(seed)}`;
}

/**
 * Enlace absoluto a la vista previa compartible (`/s/<token>`), pensado para
 * pegar en redes: el servidor devuelve Open Graph propio y redirige al
 * playground con el mismo `#seed`. Devuelve `null` sin origen.
 */
export function buildShareLink(seed, { origin, lang } = {}) {
  const base = String(origin ?? "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/s/${encodeShortToken(seed)}${lang === "en" ? "?l=en" : ""}`;
}

/** Lee `#seed=...`; devuelve `null` si el fragmento no contiene una semilla. */
export function readShareHash(hash) {
  const match = /(?:^#|&)seed=([~A-Za-z0-9_-]+)/.exec(String(hash ?? ""));
  return match ? decodeAnyToken(match[1]) : null;
}

export function buildWidgetSnippet(seed, { base = DEFAULT_WIDGET_BASE } = {}) {
  const origin = String(base).replace(/\/+$/, "");
  return [
    "<!-- vibedom: música generativa de tu web -->",
    `<script src="${origin}/widget.js"`,
    `        data-seed="${encodeSeed(seed)}"`,
    "        defer></script>",
  ].join("\n");
}
