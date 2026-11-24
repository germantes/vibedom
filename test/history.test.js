import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  addHistoryEntry,
  clearHistory,
  readHistory,
} from "../src/history.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function seed(url = "https://example.com", vibe = "Sereno y luminoso") {
  return {
    metadata: { url, detectedVibe: vibe, explanation: "…" },
    uiTheme: { backgroundColor: "#111111", accentColor: "#00ff66", textColor: "#eeeeee" },
    musicalParams: { bpm: 90, rootNote: "C", scale: "major", octave: 4 },
    synthConfig: {},
  };
}

test("el historial empieza vacío sin storage o sin datos", () => {
  assert.deepEqual(readHistory(null), []);
  assert.deepEqual(readHistory(memoryStorage()), []);
});

test("addHistoryEntry guarda host, vibe y semilla, y readHistory los devuelve", () => {
  const storage = memoryStorage();
  addHistoryEntry(storage, { url: "https://www.stripe.com/about", seed: seed("https://www.stripe.com/about") });

  const entries = readHistory(storage);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].host, "stripe.com");
  assert.equal(entries[0].url, "https://www.stripe.com/about");
  assert.equal(entries[0].vibe, "Sereno y luminoso");
  assert.equal(entries[0].seed.metadata.detectedVibe, "Sereno y luminoso");
  assert.equal(typeof entries[0].at, "number");
});

test("re-escanear la misma URL la mueve arriba sin duplicados", () => {
  const storage = memoryStorage();
  addHistoryEntry(storage, { url: "https://a.example", seed: seed("https://a.example") });
  addHistoryEntry(storage, { url: "https://b.example", seed: seed("https://b.example") });
  addHistoryEntry(storage, { url: "https://a.example", seed: seed("https://a.example") });

  const entries = readHistory(storage);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].url, "https://a.example");
  assert.equal(entries[1].url, "https://b.example");
});

test("el historial se recorta al límite global", () => {
  const storage = memoryStorage();
  for (let i = 0; i < HISTORY_LIMIT + 4; i += 1) {
    addHistoryEntry(storage, { url: `https://host-${i}.example`, seed: seed(`https://host-${i}.example`) });
  }

  const entries = readHistory(storage);
  assert.equal(entries.length, HISTORY_LIMIT);
  assert.equal(entries[0].url, `https://host-${HISTORY_LIMIT + 3}.example`);
});

test("readHistory tolera JSON corrupto y formatos inesperados", () => {
  const storage = memoryStorage();
  storage.setItem(HISTORY_KEY, "{no soy json");
  assert.deepEqual(readHistory(storage), []);

  storage.setItem(HISTORY_KEY, JSON.stringify({ no: "array" }));
  assert.deepEqual(readHistory(storage), []);

  storage.setItem(HISTORY_KEY, JSON.stringify(["pinto", { url: "sin-semilla" }, null]));
  assert.deepEqual(readHistory(storage), []);
});

test("addHistoryEntry no muta la semilla original ni rompe con storage bloqueado", () => {
  const storage = memoryStorage();
  const original = seed("https://example.com");
  addHistoryEntry(storage, { url: "https://example.com", seed: original });

  original.metadata.detectedVibe = "Cambiado después";
  assert.equal(readHistory(storage)[0].vibe, "Sereno y luminoso");

  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {},
  };
  const entries = addHistoryEntry(broken, { url: "https://example.com", seed: seed("https://example.com") });
  assert.deepEqual(entries, []);
});

test("entradas sin URL http(s) o sin semilla se ignoran", () => {
  const storage = memoryStorage();
  assert.deepEqual(addHistoryEntry(storage, { url: "ftp://ejemplo", seed: seed() }), []);
  assert.deepEqual(addHistoryEntry(storage, { url: "https://ejemplo.com", seed: null }), []);
  assert.deepEqual(readHistory(storage), []);
});

test("clearHistory borra el historial sin lanzar", () => {
  const storage = memoryStorage();
  addHistoryEntry(storage, { url: "https://example.com", seed: seed("https://example.com") });
  clearHistory(storage);
  assert.deepEqual(readHistory(storage), []);

  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("bloqueado");
    },
  };
  assert.doesNotThrow(() => clearHistory(broken));
  assert.doesNotThrow(() => clearHistory(null));
});
